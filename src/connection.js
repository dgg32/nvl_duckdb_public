import { processNodes } from './utils';

// Server configuration
const SERVER_URL = "http://localhost:3000";
const QUERY_API_URL = `${SERVER_URL}/api/query`;
const NEIGHBOR_API_URL = `${SERVER_URL}/api/neighbors`;
export { SERVER_URL, QUERY_API_URL, NEIGHBOR_API_URL };

/**
 * Determine if an object is a node by checking for required properties
 * @param {Object} obj - Object to check
 * @returns {boolean} True if the object represents a node
 */
function isNode(obj) {
  return obj && typeof obj === 'object' && obj.id && obj.label;
}

/**
 * Determine if an object is a relationship by checking for required properties
 * @param {Object} obj - Object to check
 * @returns {boolean} True if the object represents a relationship
 */
function isRelationship(obj) {
  return obj && typeof obj === 'object' && obj.from_id && obj.to_id && obj.label;
}

/**
 * Extract all nodes and relationships from query results
 * @param {Array} results - API query results
 * @returns {Object} Object containing nodes map and relationships map
 */
function extractGraphElements(results) {
  const nodesMap = new Map();
  const relationshipsMap = new Map();

  results.forEach(item => {
    // Extract nodes
    Object.entries(item).forEach(([key, value]) => {
      if (isNode(value)) {
        const nodeId = value.id;
        if (!nodesMap.has(nodeId)) {
          nodesMap.set(nodeId, {
            id: nodeId,
            labels: [value.label],
            properties: { ...value }
          });
        } else {
          // Merge properties if node already exists
          const existingNode = nodesMap.get(nodeId);
          existingNode.properties = { ...existingNode.properties, ...value };
        }
      }
      
      // Extract relationships
      if (isRelationship(value)) {
        const fromId = value.from_id;
        const toId = value.to_id;
        const relType = value.label.toUpperCase();
        
        // Create properties object excluding structural properties
        const relProperties = { ...value };
        delete relProperties.from_id;
        delete relProperties.to_id;
        delete relProperties.label;
        
        // Create consistent relationship ID
        const relId = `${fromId}_${relType}_${toId}`;
        
        // Only add if relationship doesn't exist
        if (!relationshipsMap.has(relId)) {
          relationshipsMap.set(relId, {
            id: relId,
            from: fromId,
            to: toId,
            type: relType,
            caption: relType,
            properties: relProperties
          });
        }
      }
    });
  });
  
  return { nodesMap, relationshipsMap };
}

/**
 * Apply visual styling to nodes and relationships
 * @param {Map} nodesMap - Map of node ID to node object
 * @param {Map} relationshipsMap - Map of relationship ID to relationship object
 * @returns {Object} Object containing processed nodes and relationships arrays
 */
function applyVisualStyling(nodesMap, relationshipsMap) {
  // processNodes already assigns a deterministic per-label color and caption
  const processedNodes = processNodes(Array.from(nodesMap.values()));
  const processedRelationships = Array.from(relationshipsMap.values());

  return {
    nodes: processedNodes,
    relationships: processedRelationships
  };
}

/**
 * Execute Cypher query against DuckDB database via API
 * @param {string} query - Cypher query to execute
 * @returns {Object} Object containing nodes and relationships
 */
export const executeQuery = async (query) => {
  try {
    const response = await fetch(QUERY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    const results = data.results || [];
    
    // Extract nodes and relationships from results
    const { nodesMap, relationshipsMap } = extractGraphElements(results);
    
    // Apply visual styling and return processed elements
    const { nodes, relationships } = applyVisualStyling(nodesMap, relationshipsMap);
    
    console.log(`Query returned ${nodes.length} nodes and ${relationships.length} relationships`);
    return { nodes, relationships };
  } catch (err) {
    console.error(`Connection error: ${err.message}`);
    throw err;
  }
};

/**
 * Get all relationships of a node
 * @param {string} id - ID of the node
 * @param {string} label - Label of the node
 * @param {string} direction - 'both', 'incoming', or 'outgoing'
 * @returns {Object} Raw relationship data from the API
 */
export const get_relationship_of_node = async (id, label, direction = 'both') => {
  try {
    const response = await fetch(NEIGHBOR_API_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({id: id, label: label, direction: direction})
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    console.error(`Connection error: ${err.message}`);
    throw err;
  }
};