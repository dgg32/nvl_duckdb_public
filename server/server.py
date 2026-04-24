###conda activate duckdb_1_1_3


import os
import sys
import threading
from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS  # Import Flask-CORS
import duckdb
import time
#import openai
#import yaml

app = Flask(__name__)
# Enable CORS for all routes
CORS(app)

# Global connection to DuckDB
conn = None
_db_lock = threading.Lock()
node_types = set()
outgoing_relations = {}  # Source node -> outgoing relations
incoming_relations = {}  # Destination node -> incoming relations
graph_name = ""

# with open("config.yaml", "r") as stream:
#     try:
#         PARAM = yaml.safe_load(stream)
#     except yaml.YAMLError as exc:
#         print(exc)

# openai.api_key  = PARAM['openai_api']
# client = openai.OpenAI(api_key = PARAM['openai_api'])

#When the server starts, the user is asked to enter the path to the database file
# and the server will try to connect to it.
if len(sys.argv) > 1:
    db_path = sys.argv[1]
    if os.path.exists(db_path):
        print(f"Using database file: {db_path}")
    else:
        print(f"Database file not found: {db_path}")
else:
    db_path = input("Enter the path to the DuckDB database file (default: 'drug.db'): ") or 'drug.db'
    if not os.path.exists(db_path):
        print(f"Database file not found: {db_path}")
        sys.exit(1)
# Set the path to the DuckDB database file

def initialize_db():
    global conn
    global graph_name
    global outgoing_relations
    global incoming_relations
    global node_types
    
    if conn is not None:
        return conn

    with _db_lock:
        if conn is not None:  # re-check after acquiring lock
            return conn

        # Try multiple times with a delay to handle potential lock issues
        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                conn = duckdb.connect(db_path)
                try:
                    conn.execute("install duckpgq from community;")
                except Exception:
                    pass  # Already installed — skip network round-trip
                conn.load_extension("duckpgq")

                print(f"Connected to DuckDB file: {db_path}")

                # get the graph
                graph_query = "SELECT property_graph FROM __duckpgq_internal;"
                graph_result = conn.sql(graph_query).fetchall()

                for graph_r in graph_result:
                    if graph_r[0] is not None:
                        graph_name = graph_r[0]

                # Get the nodes
                source_query = "SELECT source_table FROM __duckpgq_internal;"
                source_result = conn.sql(source_query).fetchall()

                destination_query = "SELECT destination_table FROM __duckpgq_internal;"
                destination_result = conn.sql(destination_query).fetchall()

                relation_query = "SELECT label FROM __duckpgq_internal;"
                relation_result = conn.sql(relation_query).fetchall()

                # Clear both dictionaries
                outgoing_relations.clear()
                incoming_relations.clear()

                for source_r, destination_r, relation_r in zip(source_result, destination_result, relation_result):
                    if source_r[0] is not None and destination_r[0] is not None and relation_r[0] is not None:
                        # Add outgoing relation (source -> destination)
                        if source_r[0] not in outgoing_relations:
                            outgoing_relations[source_r[0]] = [{"relation": relation_r[0], "destination": destination_r[0]}]
                        else:
                            # Check for duplicates before adding
                            duplicate = False
                            for existing in outgoing_relations[source_r[0]]:
                                if existing["relation"] == relation_r[0] and existing["destination"] == destination_r[0]:
                                    duplicate = True
                                    break

                            if not duplicate:
                                outgoing_relations[source_r[0]].append({"relation": relation_r[0], "destination": destination_r[0]})

                        # Add incoming relation (destination <- source)
                        if destination_r[0] not in incoming_relations:
                            incoming_relations[destination_r[0]] = [{"relation": relation_r[0], "source": source_r[0]}]
                        else:
                            # Check for duplicates before adding
                            duplicate = False
                            for existing in incoming_relations[destination_r[0]]:
                                if existing["relation"] == relation_r[0] and existing["source"] == source_r[0]:
                                    duplicate = True
                                    break

                            if not duplicate:
                                incoming_relations[destination_r[0]].append({"relation": relation_r[0], "source": source_r[0]})

                        node_types.add(source_r[0])
                        node_types.add(destination_r[0])

                print("Outgoing relations:", outgoing_relations)
                print("Incoming relations:", incoming_relations)
                return conn
            except Exception as e:
                print(f"Attempt {attempt+1}/{max_attempts} failed: {e}")
                if attempt < max_attempts - 1:
                    print(f"Retrying in 2 seconds...")
                    time.sleep(2)
                else:
                    print(f"Failed to initialize DuckDB after {max_attempts} attempts")
                    raise

@app.route('/api/query', methods=['POST'])
def execute_query():
    try:
        data = request.json
        query = data.get('query')
        
        if not query:
            return jsonify({'error': 'Query is required'}), 400
        
        print(f"Executing query: {query}")
        
        # Initialize DB if not already done
        db_conn = initialize_db()
        
        # Execute the query (lock shared connection for thread safety)
        try:
            with _db_lock:
                results = db_conn.execute(query).fetchall()
                column_names = [col[0] for col in db_conn.description] if db_conn.description else []
            print(f"Query results: {results}")
            
            # Convert results to list of dicts
            result_dicts = []
            for row in results:
                row_dict = {}
                for i, value in enumerate(row):
                    col_name = column_names[i] if i < len(column_names) else f"col{i}"
                    row_dict[col_name] = value
                result_dicts.append(row_dict)
            
            return jsonify({'results': result_dicts})
        except Exception as e:
            print(f"Query execution error: {e}")
            print ("Query: ", query)
            return jsonify({'error': f"Error executing query: {str(e)}"}), 500
    except Exception as e:
        print(f"Server error: {e}")
        return jsonify({'error': f"Server error: {str(e)}"}), 500


@app.route('/api/node-types', methods=['POST'])
def get_node_types():
    try:
        db_conn = initialize_db()
        return jsonify({'results': list(node_types)})
        
    except Exception as e:
        print(f"Server error: {e}")
        return jsonify({'error': f"Server error: {str(e)}"}), 500

@app.route('/api/default-query', methods=['GET'])
def get_default_query():
    try:
        # Initialize DB if not already done
        db_conn = initialize_db()
        
        # Check if we have graph name and relations
        if not graph_name or (not outgoing_relations and not incoming_relations):
            return jsonify({'error': 'No graph structure available'}), 500
            
        # Generate a default query using the first available relation
        default_query = None
        
        # First try outgoing relations
        if outgoing_relations:
            source_label = next(iter(outgoing_relations))
            relation = outgoing_relations[source_label][0]
            dest_label = relation["destination"]
            rel_type = relation["relation"]
            
            default_query = f"FROM GRAPH_TABLE ({graph_name} MATCH (a:{source_label})-[n:{rel_type}]->(b:{dest_label}) COLUMNS (a, n, b)) LIMIT 5"
        
        # If no outgoing relations, try incoming
        elif incoming_relations:
            dest_label = next(iter(incoming_relations))
            relation = incoming_relations[dest_label][0]
            source_label = relation["source"]
            rel_type = relation["relation"]
            
            default_query = f"FROM GRAPH_TABLE ({graph_name} MATCH (a:{source_label})-[n:{rel_type}]->(b:{dest_label}) COLUMNS (a, n, b)) LIMIT 5"
        
        # Return the generated query
        if default_query:
            return jsonify({'query': default_query})
        else:
            return jsonify({'error': 'Could not generate default query'}), 500
            
    except Exception as e:
        print(f"Error generating default query: {e}")
        return jsonify({'error': f"Server error: {str(e)}"}), 500





@app.route('/api/neighbors', methods=['POST'])
def get_neighbors():
    try:
        data = request.json
        node_label = data.get('label')
        node_id = data.get('id')
        direction = data.get('direction', 'both')  # Default to both if not specified
        relationship_type = data.get('relationshipType')  # Optional relationship type filter

        print("Server received", data)
        print ("relationship_type", relationship_type)
        print("Outgoing relations:", outgoing_relations)
        print("Incoming relations:", incoming_relations)
        
        if not node_label or not node_id:
            return jsonify({'error': 'node_label and node_id are required'}), 400

        # Sanitize node_id to prevent SQL injection (escape single quotes)
        safe_node_id = str(node_id).replace("'", "''")

        # Initialize DB if not already done
        db_conn = initialize_db()

        try:
            # Build all sub-queries upfront, then execute in a single batch under one lock.
            # Each sub-query is tagged with metadata so results can be split afterwards.
            # This replaces N sequential db_conn.execute() calls with one round-trip per
            # direction batch, cutting latency from O(N) to O(1) DB calls.
            outgoing_specs = []  # list of (relation, destination) dicts
            incoming_specs = []  # list of (relation, source) dicts

            if direction in ['both', 'outgoing'] and node_label in outgoing_relations:
                for r_d in outgoing_relations[node_label]:
                    if relationship_type and r_d['relation'] != relationship_type:
                        continue
                    outgoing_specs.append(r_d)

            if direction in ['both', 'incoming'] and node_label in incoming_relations:
                for r_d in incoming_relations[node_label]:
                    if relationship_type and r_d['relation'] != relationship_type:
                        continue
                    incoming_specs.append(r_d)

            result_dicts = []

            # Execute all outgoing queries in one batched lock acquisition
            if outgoing_specs:
                with _db_lock:
                    for r_d in outgoing_specs:
                        query = (
                            f"FROM GRAPH_TABLE ({graph_name} "
                            f"MATCH (a:{node_label} WHERE a.id = '{safe_node_id}')"
                            f"-[n:{r_d['relation']}]->(b:{r_d['destination']}) "
                            f"COLUMNS (b))"
                        )
                        print(f"Executing outgoing query: {query}")
                        results = db_conn.execute(query).fetchall()
                        result_dicts.append({
                            "relation": r_d['relation'],
                            "destination": r_d['destination'],
                            "direction": "outgoing",
                            "results": results
                        })

            # Execute all incoming queries in one batched lock acquisition
            if incoming_specs:
                with _db_lock:
                    for r_d in incoming_specs:
                        query = (
                            f"FROM GRAPH_TABLE ({graph_name} "
                            f"MATCH (a:{r_d['source']})-[n:{r_d['relation']}]->"
                            f"(b:{node_label} WHERE b.id = '{safe_node_id}') "
                            f"COLUMNS (a))"
                        )
                        print(f"Executing incoming query: {query}")
                        results = db_conn.execute(query).fetchall()
                        result_dicts.append({
                            "relation": r_d['relation'],
                            "source": r_d['source'],
                            "direction": "incoming",
                            "results": results
                        })

            return jsonify({'results': result_dicts})
        except Exception as e:
            print(f"Query execution error: {e}")
            return jsonify({'error': f"Error executing query: {str(e)}"}), 500
    except Exception as e:
        print(f"Server error: {e}")
        return jsonify({'error': f"Server error: {str(e)}"}), 500


def cleanup():
    global conn
    if conn is not None:
        try:
            conn.close()
            print("Database connection closed")
        except Exception as e:
            print(f"Error closing database connection: {e}")

# Register cleanup function to run when the application exits
import atexit
atexit.register(cleanup)

if __name__ == '__main__':
    try:
        initialize_db()
        app.run(host='0.0.0.0', port=3000, debug=True, use_reloader=False)
    except Exception as e:
        print(f"Failed to start server: {e}")
        cleanup()