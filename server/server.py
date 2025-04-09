###conda activate duckdb_1_1_3


import os
import sys
from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS  # Import Flask-CORS
import duckdb
import time
import openai
import yaml

app = Flask(__name__)
# Enable CORS for all routes
CORS(app)

# Global connection to DuckDB
conn = None
node_types = set()
outgoing_relations = {}  # Source node -> outgoing relations
incoming_relations = {}  # Destination node -> incoming relations
graph_name = ""

with open("config.yaml", "r") as stream:
    try:
        PARAM = yaml.safe_load(stream)
    except yaml.YAMLError as exc:
        print(exc)

openai.api_key  = PARAM['openai_api']
client = openai.OpenAI(api_key = PARAM['openai_api'])

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
    
    # Try multiple times with a delay to handle potential lock issues
    max_attempts = 3
    for attempt in range(max_attempts):
        try:
            # Path to your existing database file
            #db_path = 'drug.db'
            
            # Try to connect with a unique access mode to avoid conflicts
            # Using the timestamp to create a unique identifier
            conn = duckdb.connect(db_path)
            conn.install_extension("duckpgq", repository="community")
            conn.load_extension("duckpgq")

            conn.sql("INSTALL vss;")
            conn.load_extension("vss")

            def get_embedding(text: str) -> list[float]:
                model="text-embedding-3-small"
                text = text.replace("\n", " ")
                return client.embeddings.create(input = [text], model=model).data[0].embedding

            conn.create_function('embeddings', get_embedding)
            
            print(f"Connected to DuckDB file: {db_path}")
            
            # Test the connection
            test_query = "SELECT * FROM Drug LIMIT 5;"
            results = conn.sql(test_query).fetchall()
            print(f"Testing '{test_query}':", results)

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
        
        # Execute the query
        try:
            results = db_conn.execute(query).fetchall()
            print(f"Query results: {results}")
            
            # Get column names
            column_names = [col[0] for col in db_conn.description] if db_conn.description else []
            
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
        print("Outgoing relations:", outgoing_relations)
        print("Incoming relations:", incoming_relations)
        
        if not node_label or not node_id:
            return jsonify({'error': 'node_label and node_id are required'}), 400
        
        # Initialize DB if not already done
        db_conn = initialize_db()
        
        try:
            result_dicts = []
            
            # Process outgoing relations if direction is 'both' or 'outgoing'
            if direction in ['both', 'outgoing'] and node_label in outgoing_relations:
                for r_d in outgoing_relations[node_label]:
                    # Skip if relationship_type is specified and doesn't match
                    if relationship_type and r_d['relation'] != relationship_type:
                        continue
                        
                    print("Processing outgoing relation:", r_d)
                    query = f"""FROM GRAPH_TABLE ({graph_name}
                                MATCH
                                    (a:{node_label} WHERE a.id = '{node_id}')-[n:{r_d['relation']}]->(b:{r_d['destination']})
                                COLUMNS (b)
                                )
                            """
                    print(f"Executing query: {query}")
                    results = db_conn.execute(query).fetchall()
                    result_dicts.append({
                        "relation": r_d['relation'], 
                        "destination": r_d['destination'], 
                        "direction": "outgoing",
                        "results": results
                    })
            
            # Process incoming relations if direction is 'both' or 'incoming'
            if direction in ['both', 'incoming'] and node_label in incoming_relations:
                for r_d in incoming_relations[node_label]:
                    # Skip if relationship_type is specified and doesn't match
                    if relationship_type and r_d['relation'] != relationship_type:
                        continue
                        
                    print("Processing incoming relation:", r_d)
                    query = f"""FROM GRAPH_TABLE ({graph_name}
                                MATCH
                                    (a:{r_d['source']})-[n:{r_d['relation']}]->(b:{node_label} WHERE b.id = '{node_id}')
                                COLUMNS (a)
                                )
                            """
                    print(f"Executing query: {query}")
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
        # Start the Flask development server
        app.run(host='0.0.0.0', port=3000, debug=True)
    except Exception as e:
        print(f"Failed to start server: {e}")
        cleanup()