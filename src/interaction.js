import { expandNode, colorMap, get_relationship_of_node} from "./connection";
import { getBestNodeCaption, formatPropertyValue, showNotification, displayProperties } from "./utils";
import {
  PanInteraction,
  ZoomInteraction,
  DragNodeInteraction,
  ClickInteraction
} from "@neo4j-nvl/interaction-handlers";

import './graph-styles.css';

// State tracking for graph expansion
const nodeOwnership = new Map(); // Tracks which nodes expanded which other nodes
const nodeRelationshipsByType = new Map(); // Tracks relationship types for each node
const expandedNodes = new Map(); // Map of node ID -> array of child node IDs
const initialNodeIds = new Set(); // Set to track original nodes
const initialRelationshipIds = new Set(); // Set to track original relationships
const expandedRelationships = new Map(); // Map of node ID -> Set of relationship IDs
const nodeHierarchy = new Map(); // Map of parent node ID -> Set of direct child node IDs

const default_node_color = "#4682B4";
/**
 * Save the initial state of the graph to track which nodes/relationships were original
 * @param {Object} nvl - NVL instance
 */
export const saveInitialGraphState = (nvl) => {
  if (!nvl) return;
  
  try {
    // Clear any previous state
    initialNodeIds.clear();
    expandedNodes.clear();
    expandedRelationships.clear();
    nodeHierarchy.clear();
    nodeOwnership.clear();
    
    // Save initial node IDs
    const currentNodes = nvl.getNodes();
    if (currentNodes && Array.isArray(currentNodes)) {
      currentNodes.forEach(node => {
        if (node && node.id) {
          initialNodeIds.add(node.id);
          console.log(`Added initial node: ${node.id} (${getBestNodeCaption(node)})`);
        }
      });
    }

    // Save initial relationship IDs
    const currentRelationships = nvl.getRelationships();
    if (currentRelationships && Array.isArray(currentRelationships)) {
      currentRelationships.forEach(rel => {
        if (rel && rel.id) {
          initialRelationshipIds.add(rel.id);
          console.log(`Added initial relationship: ${rel.id}`);
        }
      });
    }
    
    console.log("Saved initial graph state with nodes:", initialNodeIds.size);
  } catch (error) {
    console.error("Error saving initial graph state:", error);
  }
};

/**
 * Set up enhanced DragNodeInteraction with safety features
 * @param {Object} dragNodeInteraction - The interaction handler to enhance
 */
function enhanceDragNodeInteraction(dragNodeInteraction) {
  // If the interaction doesn't exist or is invalid, don't try to enhance it
  if (!dragNodeInteraction || typeof dragNodeInteraction !== 'object') {
    console.warn("Invalid dragNodeInteraction provided to enhanceDragNodeInteraction");
    return;
  }
  // Add reset state method
  dragNodeInteraction.resetState = function() {
    this.isDragging = false;
    this.mouseDownNode = null;
    this.isDrawing = false;
    this.selectedNodes = [];
    this.moveSelectedNodes = false;
    this.mousePosition = { x: 0, y: 0 };
  };
  
  // Also enhance the handleMouseUp method for safety
  const originalHandleMouseUp = dragNodeInteraction.handleMouseUp;
  dragNodeInteraction.handleMouseUp = function(evt) {
    try {
      if (this.isDragging) {
        if (this.moveSelectedNodes && this.selectedNodes && Array.isArray(this.selectedNodes)) {
          this.callCallbackIfRegistered('onDragEnd', this.selectedNodes, evt);
        } else if (this.mouseDownNode && this.mouseDownNode.data) {
          this.callCallbackIfRegistered('onDragEnd', [this.mouseDownNode.data], evt);
        }
      }
    } catch (error) {
      console.error("Error in handleMouseUp:", error);
    } finally {
      // Always reset state on mouse up
      this.resetState();
    }
  };
  
  // Complete override of the handleMouseMove method for enhanced safety
  dragNodeInteraction.handleMouseMove = function(evt) {
    // Skip if conditions aren't right for dragging
    if (!this.mouseDownNode || evt.buttons !== 1 || this.isDrawing) {
      return;
    }
    
    // Skip if we can't verify the mouse position for dragging movement
    if (typeof this.mousePosition !== 'object' || 
        this.mousePosition === null || 
        typeof this.mousePosition.x !== 'number' || 
        typeof this.mousePosition.y !== 'number') {
      console.warn("Invalid mouse position in handleMouseMove");
      return;
    }
    
    // Add isDraggingMovement check if available
    if (typeof isDraggingMovement === 'function') {
      if (!isDraggingMovement(evt, this.mousePosition)) {
        return;
      }
    }
    
    // Safety check for mouseDownNode.data
    if (!this.mouseDownNode.data || !this.mouseDownNode.data.id) {
      console.warn("mouseDownNode.data is invalid in handleMouseMove");
      return;
    }

    // Safety check for target coordinates
    if (!this.mouseDownNode.targetCoordinates || 
        typeof this.mouseDownNode.targetCoordinates.x !== 'number' || 
        typeof this.mouseDownNode.targetCoordinates.y !== 'number') {
      console.warn("mouseDownNode.targetCoordinates is invalid in handleMouseMove");
      return;
    }
    
    try {
      if (!this.isDragging) {
        if (this.moveSelectedNodes && this.selectedNodes && Array.isArray(this.selectedNodes)) {
          this.callCallbackIfRegistered('onDragStart', this.selectedNodes, evt);
        } else {
          this.callCallbackIfRegistered('onDragStart', [this.mouseDownNode.data], evt);
        }
        this.isDragging = true;
      }
      
      // Calculate movement
      const zoom = this.nvlInstance.getScale();
      const dx = ((evt.clientX - this.mousePosition.x) / zoom) * window.devicePixelRatio;
      const dy = ((evt.clientY - this.mousePosition.y) / zoom) * window.devicePixelRatio;
      
      if (this.moveSelectedNodes && this.selectedNodes && Array.isArray(this.selectedNodes)) {
        // Check if we have valid selectedNodes with required properties
        const validNodes = this.selectedNodes.filter(node => 
          node && typeof node.id === 'string' && typeof node.x === 'number' && typeof node.y === 'number'
        );
        
        if (validNodes.length > 0) {
          this.nvlInstance.setNodePositions(
            validNodes.map(node => ({ id: node.id, x: node.x + dx, y: node.y + dy, pinned: true })), 
            true
          );
          this.callCallbackIfRegistered('onDrag', validNodes, evt);
        }
      } else {
        this.nvlInstance.setNodePositions([
          {
            id: this.mouseDownNode.data.id,
            x: this.mouseDownNode.targetCoordinates.x + dx,
            y: this.mouseDownNode.targetCoordinates.y + dy,
            pinned: true
          }
        ], true);
        this.callCallbackIfRegistered('onDrag', [this.mouseDownNode.data], evt);
      }
    } catch (error) {
      console.error("Error in handleMouseMove:", error);
      this.resetState();
    }
  };
}


/**
 * Configure safety event handlers for the canvas
 * @param {HTMLElement} canvas - The canvas element
 * @param {Object} dragNodeInteraction - The drag interaction handler
 */
function setupCanvasSafetyHandlers(canvas, dragNodeInteraction) {
  if (!canvas) return;
  
  // Reset mouse state on mouse leaving canvas
  canvas.addEventListener('mouseout', () => {
    if (dragNodeInteraction && typeof dragNodeInteraction.resetState === 'function') {
      dragNodeInteraction.resetState();
    }
  });
  
  // Also reset on mouseleave for better reliability
  canvas.addEventListener('mouseleave', () => {
    if (dragNodeInteraction && typeof dragNodeInteraction.resetState === 'function') {
      dragNodeInteraction.resetState();
    }
  });
  
  // Reset state when window loses focus
  window.addEventListener('blur', () => {
    if (dragNodeInteraction && typeof dragNodeInteraction.resetState === 'function') {
      dragNodeInteraction.resetState();
    }
  });
  
  // Add document-level mouse up handler for when dragging outside the canvas
  const docMouseUpHandler = () => {
    if (dragNodeInteraction && typeof dragNodeInteraction.resetState === 'function') {
      dragNodeInteraction.resetState();
    }
  };
  document.addEventListener('mouseup', docMouseUpHandler);
  
  // Store the handler reference for cleanup
  dragNodeInteraction._documentMouseUpHandler = docMouseUpHandler;
  
  // Enhance destroy method to clean up document-level handlers
  const originalDestroy = dragNodeInteraction.destroy;
  dragNodeInteraction.destroy = function() {
    try {
      // Remove document-level event listener
      if (this._documentMouseUpHandler) {
        document.removeEventListener('mouseup', this._documentMouseUpHandler);
        this._documentMouseUpHandler = null;
      }
      
      // Call original destroy if it exists
      if (typeof originalDestroy === 'function') {
        originalDestroy.call(this);
      }
    } catch (error) {
      console.error("Error in dragNodeInteraction.destroy:", error);
    }
  };
}

/**
 * Create relationship type selection dialog for node expansion
 * @param {Object} node - Node to expand
 * @param {Object} outgoingData - Outgoing relationships data
 * @param {Object} incomingData - Incoming relationships data
 * @param {Function} processAllRelationships - Handler for "All Relationships" button
 * @param {Function} processSpecificRelationship - Handler for specific relationship buttons
 * @returns {HTMLElement} Dialog overlay element
 */
function createRelationshipSelectionDialog(node, outgoingData, incomingData, processAllRelationships, processSpecificRelationship) {
  // Create dialog elements
  const dialogOverlay = document.createElement('div');
  dialogOverlay.className = 'dialog-overlay';
  
  const dialog = document.createElement('div');
  dialog.className = 'dialog-container';
  
  // Add title
  const title = document.createElement('h3');
  title.textContent = 'Expand Node By Relationship Type';
  title.className = 'dialog-title';
  dialog.appendChild(title);
  
  // Collect all unique relationship types
  const relTypes = new Set();
  
  if (outgoingData && outgoingData.results) {
    outgoingData.results.forEach(rel => {
      if (rel.relation) relTypes.add(rel.relation);
    });
  }
  
  if (incomingData && incomingData.results) {
    incomingData.results.forEach(rel => {
      if (rel.relation) relTypes.add(rel.relation);
    });
  }
  
  // Add "All Relationships" button
  const allButton = document.createElement('button');
  allButton.textContent = 'All Relationships';
  allButton.className = 'button-primary';
  allButton.onclick = () => {
    dialogOverlay.remove();
    processAllRelationships();
  };
  dialog.appendChild(allButton);
  
  // Add relationship-specific buttons
  if (relTypes.size > 0) {
    const separator = document.createElement('div');
    separator.textContent = 'SPECIFIC RELATIONSHIP TYPES:';
    separator.className = 'separator';
    dialog.appendChild(separator);
    
    // Sort relationship types alphabetically
    const sortedRelTypes = Array.from(relTypes).sort();
    
    for (const relType of sortedRelTypes) {
      const relButton = document.createElement('button');
      relButton.textContent = relType.toUpperCase();
      relButton.className = 'button-secondary';
      
      relButton.onclick = () => {
        dialogOverlay.remove();
        processSpecificRelationship(relType);
      };
      
      dialog.appendChild(relButton);
    }
  } else {
    const message = document.createElement('div');
    message.textContent = 'No relationships available for this node';
    message.style.margin = '16px 0';
    message.style.color = '#666';
    dialog.appendChild(message);
  }
  
  // Add cancel button
  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel';
  cancelButton.className = 'button-cancel';
  cancelButton.onclick = () => dialogOverlay.remove();
  dialog.appendChild(cancelButton);
  
  // Handle backdrop click to close dialog
  dialogOverlay.addEventListener('click', (e) => {
    if (e.target === dialogOverlay) {
      dialogOverlay.remove();
    }
  });
  
  dialogOverlay.appendChild(dialog);
  document.body.appendChild(dialogOverlay);
  
  return dialogOverlay;
}

/**
 * Show loading overlay during relationship processing
 * @param {string} relType - Relationship type being loaded
 * @returns {HTMLElement} Loading overlay element
 */
function showLoadingOverlay(relType) {
  const loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'loading-overlay';
  
  const loadingBox = document.createElement('div');
  loadingBox.className = 'loading-box';
  loadingBox.textContent = `Loading ${relType.toUpperCase()} relationships...`;

  loadingOverlay.appendChild(loadingBox);
  document.body.appendChild(loadingOverlay);
  
  return loadingOverlay;
}

/**
 * Process and visualize connections between nodes
 * @param {Object} node - The node being expanded
 * @param {Object} connections - Object containing nodes and relationships to add
 * @param {Object} nvl - NVL instance
 */
function processConnections(node, connections, nvl) {
  if (!connections || !connections.nodes || !connections.relationships) {
    console.error("Invalid connections object:", connections);
    return;
  }
  
  try {
    // 1. Register node ownership - track which nodes were added by this expansion
    const childNodeIds = connections.nodes
      .filter(n => n.id !== node.id)
      .map(n => n.id);
    
    // Record ownership for each child node
    childNodeIds.forEach(childId => {
      if (!nodeOwnership.has(childId)) {
        nodeOwnership.set(childId, new Set());
      }
      nodeOwnership.get(childId).add(node.id);
    });
    
    // 2. Track relationships by type for organized collapse
    if (!nodeRelationshipsByType.has(node.id)) {
      nodeRelationshipsByType.set(node.id, new Map());
    }
    
    const relTypeMap = nodeRelationshipsByType.get(node.id);
    connections.relationships.forEach(rel => {
      const isOutgoing = rel.from === node.id;
      const relType = rel.type.toUpperCase();
      const relatedNodeId = isOutgoing ? rel.to : rel.from;
      
      // Skip self-relationships
      if (relatedNodeId === node.id) return;
      
      // Ensure relationship type exists in the map
      if (!relTypeMap.has(relType)) {
        relTypeMap.set(relType, new Set());
      }
      
      // Add the related node to this relationship type
      relTypeMap.get(relType).add(relatedNodeId);
    });
    
    // 3. Apply consistent visual styling to nodes
    connections.nodes.forEach(n => {
      // Apply color based on label
      if (n.labels && n.labels.length > 0) {
        const label = n.labels[0];
        if (colorMap.has(label)) {
          n.color = colorMap.get(label);
        }
        else {
          n.color = default_node_color; // Default color
        }
      }
      
      // Set caption using the utility function
      n.caption = getBestNodeCaption(n);
    });

    // 4. Update tracking structures
    
    // Update hierarchy
    if (!nodeHierarchy.has(node.id)) {
      nodeHierarchy.set(node.id, new Set());
    }
    
    childNodeIds.forEach(id => nodeHierarchy.get(node.id).add(id));
    expandedNodes.set(node.id, childNodeIds);
    
    // Track relationships
    if (!expandedRelationships.has(node.id)) {
      expandedRelationships.set(node.id, new Set());
    }
    
    // Normalize relationship types and create consistent IDs
    connections.relationships.forEach(rel => {
      rel.type = rel.type.toUpperCase();
      rel.caption = rel.caption ? rel.caption.toUpperCase() : rel.type;
      
      // Ensure consistent relationship ID format
      rel.id = `${rel.from}_${rel.type}_${rel.to}`;
      expandedRelationships.get(node.id).add(rel.id);
    });
    
    // 5. Filter out duplicate relationships
    const existingRelIds = new Set();
    nvl.getRelationships().forEach(r => {
      if (r && r.from && r.to) {
        const type = (r.type || r.caption || '').toUpperCase();
        existingRelIds.add(`${r.from}_${type}_${r.to}`);
      }
    });

    // Filter out relationships that already exist
    const newRels = connections.relationships.filter(r => !existingRelIds.has(r.id));

    // Normalize relationships before adding to graph
    newRels.forEach(rel => {
      rel.type = rel.type.toUpperCase();
      rel.caption = rel.caption ? rel.caption.toUpperCase() : rel.type;
      rel.id = `${rel.from}_${rel.type}_${rel.to}`;
    });
    
    // 6. Add to graph
    console.log(`Adding ${connections.nodes.length} nodes and ${newRels.length} relationships to graph`);
    nvl.addAndUpdateElementsInGraph(connections.nodes, newRels);
    
    // 7. Adjust view
    if (connections.nodes.length > 0) {
      nvl.fit(connections.nodes.map(n => n.id));
    }
  } catch (error) {
    console.error("Error processing connections:", error);
  }
}

/**
 * Process a specific relationship type from node data
 * @param {string} relType - Relationship type to process
 * @param {Object} outgoingData - Outgoing relationships data
 * @param {Object} incomingData - Incoming relationships data
 * @param {Object} node - Source node
 * @returns {Object} Processed connections with nodes and relationships
 */
function processRelationshipType(relType, outgoingData, incomingData, node) {
  // Initialize empty arrays for nodes and relationships
  let outNodes = [];
  let outRels = [];
  let inNodes = [];
  let inRels = [];
  
  // Process outgoing relationships of this type
  const outResults = outgoingData.results.filter(r => r.relation === relType);
  for (const rel of outResults) {
    if (rel.results && rel.results.length > 0) {
      for (const row of rel.results) {
        for (const targetNode of row) {
          // Add to outNodes - make sure to check the node label
          const nodeLabel = targetNode.label || '';
          
          // Determine node color based on label
          let nodeColor = null;
          if (colorMap.has(nodeLabel)) {
            nodeColor = colorMap.get(nodeLabel);
          } else {
            nodeColor = default_node_color; // Default color
          }
          
          outNodes.push({
            id: targetNode.id,
            labels: [nodeLabel],
            properties: {...targetNode},
            caption: getBestNodeCaption(targetNode),
            color: nodeColor
          });
          
          // Create relationship - normalize relationship type to uppercase
          const normalizedRelType = relType.toUpperCase();
          const relId = `${node.id}_${normalizedRelType}_${targetNode.id}`;
          outRels.push({
            id: relId,
            from: node.id,
            to: targetNode.id,
            type: normalizedRelType,
            caption: normalizedRelType
          });
        }
      }
    }
  }
  
  // Process incoming relationships of this type
  const inResults = incomingData.results.filter(r => r.relation === relType);
  for (const rel of inResults) {
    if (rel.results && rel.results.length > 0) {
      for (const row of rel.results) {
        for (const sourceNode of row) {
          // Add to inNodes - make sure to check the node label
          const nodeLabel = sourceNode.label || '';
          
          // Determine node color based on label
          let nodeColor = null;
          if (colorMap.has(nodeLabel)) {
            nodeColor = colorMap.get(nodeLabel);
          } else {
            nodeColor = default_node_color; // Default color
          }
          
          inNodes.push({
            id: sourceNode.id,
            labels: [nodeLabel],
            properties: {...sourceNode},
            caption: getBestNodeCaption(sourceNode),
            color: nodeColor
          });
          
          // Create relationship - normalize relationship type to uppercase
          const normalizedRelType = relType.toUpperCase();
          const relId = `${sourceNode.id}_${normalizedRelType}_${node.id}`;
          inRels.push({
            id: relId,
            from: sourceNode.id,
            to: node.id,
            type: normalizedRelType,
            caption: normalizedRelType
          });
        }
      }
    }
  }
  
  // Combine all nodes and relationships
  const allNodes = [
    // Include the original node
    {
      id: node.id,
      labels: node.labels,
      properties: node.properties,
      caption: getBestNodeCaption(node), 
      color: node.color
    },
    ...outNodes,
    ...inNodes
  ];
  
  const allRels = [...outRels, ...inRels];
  
  // Deduplicate nodes and relationships
  const uniqueNodes = [];
  const nodeIds = new Set();
  
  for (const n of allNodes) {
    if (!nodeIds.has(n.id)) {
      nodeIds.add(n.id);
      uniqueNodes.push(n);
    }
  }
  
  // Ensure relationship IDs are case-normalized
  const uniqueRels = [];
  const normalizedRelIds = new Set();
  
  for (const r of allRels) {
    const normalizedId = `${r.from}_${r.type.toUpperCase()}_${r.to}`;
    
    if (!normalizedRelIds.has(normalizedId)) {
      normalizedRelIds.add(normalizedId);
      r.id = normalizedId;
      uniqueRels.push(r);
    }
  }
  
  return {
    nodes: uniqueNodes,
    relationships: uniqueRels
  };
}

/**
 * Process a node collapse operation
 * @param {Object} node - Node to collapse
 * @param {Object} nvl - NVL instance
 */
function collapseNode(node, nvl) {
  console.log(`Collapsing node ${node.id}`);
  showNotification(`Collapsing: ${getBestNodeCaption(node)}`);
  
  // Track all nodes and relationships that should be removed
  const nodesToRemove = new Set();
  const relationshipsToRemove = new Set();
  
  // 1. Get expanded nodes in order of expansion
  const expandedNodeIds = Array.from(expandedNodes.keys());
  const collapsingIndex = expandedNodeIds.indexOf(node.id);
  
  if (collapsingIndex === -1) {
    console.error(`Node ${node.id} not found in expanded nodes!`);
    return;
  }
  
  // 2. Get all nodes expanded after the current one (including the current one)
  const nodesToCollapse = [node.id, ...expandedNodeIds.slice(collapsingIndex + 1)];
  const remainingExpandedNodes = expandedNodeIds.slice(0, collapsingIndex);
  
  console.log(`Collapsing nodes: ${nodesToCollapse.join(', ')}`);
  console.log(`Remaining expanded nodes: ${remainingExpandedNodes.join(', ')}`);
  
  // 3. Gather all nodes that were added by the nodes being collapsed
  nodesToCollapse.forEach(expandedNodeId => {
    // Get direct children of this expanded node
    const directChildren = expandedNodes.get(expandedNodeId) || [];
    
    directChildren.forEach(childId => {
      // Skip initial nodes - we never want to remove these
      if (initialNodeIds.has(childId)) {
        return;
      }
      
      // Check if any remaining expanded node owns this child
      if (nodeOwnership.has(childId)) {
        const owners = nodeOwnership.get(childId);
        const hasRemainingOwner = Array.from(owners).some(owner => 
          remainingExpandedNodes.includes(owner)
        );
        
        if (hasRemainingOwner) {
          console.log(`Node ${childId} is still owned by remaining expanded node - will keep`);
          return;
        }
      }
      
      // Add this child to nodes to remove
      nodesToRemove.add(childId);
      console.log(`Will remove node ${childId} - added by ${expandedNodeId}`);
    });
    
    // Get relationships added by this expansion
    const expandedRels = expandedRelationships.get(expandedNodeId) || new Set();
    expandedRels.forEach(relId => {
      // NEVER remove initial relationships
      if (!initialRelationshipIds.has(relId)) {
        relationshipsToRemove.add(relId);
      }
    });
  });
  
  // 4. Perform removals
  const nodeIdsToRemove = Array.from(nodesToRemove);
  const relationshipIdsToRemove = Array.from(relationshipsToRemove);
  
  // Remove relationships first
  if (relationshipIdsToRemove.length > 0) {
    console.log(`Removing ${relationshipIdsToRemove.length} relationships`);
    nvl.removeRelationshipsWithIds(relationshipIdsToRemove);
  }
  
  // Then remove nodes
  if (nodeIdsToRemove.length > 0) {
    console.log(`Removing ${nodeIdsToRemove.length} nodes`);
    nvl.removeNodesWithIds(nodeIdsToRemove);
    
    // Update ownership records
    nodeIdsToRemove.forEach(childId => {
      if (nodeOwnership.has(childId)) {
        // Remove ownership records for collapsed nodes
        nodesToCollapse.forEach(expandedId => {
          if (nodeOwnership.get(childId)) {
            nodeOwnership.get(childId).delete(expandedId);
          }
        });
        
        // If no owners remain, delete the entry
        if (nodeOwnership.get(childId).size === 0) {
          nodeOwnership.delete(childId);
        }
      }
    });
  }
  
  // 5. Clean up expansion state for all collapsed nodes
  nodesToCollapse.forEach(expandedId => {
    expandedRelationships.delete(expandedId);
    expandedNodes.delete(expandedId);
    nodeRelationshipsByType.delete(expandedId);
    nodeHierarchy.delete(expandedId);
    console.log(`Cleaned up expansion state for ${expandedId}`);
  });
  
  console.log("Collapse complete.");
}

/**
 * Setup all interaction handlers for the graph
 * @param {Object} nvl - NVL instance
 * @returns {Object} Object containing all interaction handlers
 */
export const setupInteraction = (nvl) => {
  if (!nvl) {
    console.error("NVL instance is not defined");
    return;
  }
  
  try {
    // Create interaction handlers
    const panInteraction = new PanInteraction(nvl);
    const zoomInteraction = new ZoomInteraction(nvl);
    const dragNodeInteraction = new DragNodeInteraction(nvl);
    const clickInteraction = new ClickInteraction(nvl);
    
    // Enhance drag node interaction for better stability
    enhanceDragNodeInteraction(dragNodeInteraction);
    
    // Set up canvas safety handlers
    const canvas = nvl.getContainer().querySelector('canvas');
    setupCanvasSafetyHandlers(canvas, dragNodeInteraction);
    
    // Store property display functions globally
    window.displayNodeProperties = (node) => displayProperties(node, 'node');
    window.displayRelationshipProperties = (rel) => displayProperties(rel, 'relationship');
    
    // Show properties when clicking on a node
    clickInteraction.updateCallback('onNodeClick', (node) => {
      if (!node) return;
      console.log('Node clicked', node);
      displayProperties(node, 'node');
    });
    
    // Show properties when clicking on a relationship
    clickInteraction.updateCallback('onRelationshipClick', (relationship) => {
      if (!relationship) return;
      console.log('Relationship clicked', relationship);
      displayProperties(relationship, 'relationship');
    });
    
    // Toggle expand/collapse on double-click
    clickInteraction.updateCallback('onNodeDoubleClick', async (node) => {
      if (!node || !node.id) return;
      
      console.log('Node double clicked', node);
      
      // If node is already expanded, collapse it
      if (expandedNodes.has(node.id)) {
        collapseNode(node, nvl);
      } else {
        // If not expanded, show dialog to expand
        try {
          console.log(`Expanding node ${node.id}`);
          showNotification(`Expanding: ${getBestNodeCaption(node)}`);
          
          // Fetch relationship data
          const outgoingData = await get_relationship_of_node(node.id, node.labels[0], 'outgoing');
          const incomingData = await get_relationship_of_node(node.id, node.labels[0], 'incoming');
          
          // Define handlers for dialog buttons
          const processAllRelationships = async () => {
            // Use the standard expandNode function for all relationships
            const connections = await expandNode(node.id, node.labels[0], 'both');

            if (connections && connections.nodes && connections.relationships) {
              // Make sure the original node in connections has the correct caption
              const origNodeIndex = connections.nodes.findIndex(n => n.id === node.id);
              if (origNodeIndex >= 0) {
                connections.nodes[origNodeIndex].caption = getBestNodeCaption(node);
              }
              
              // Apply caption function to all nodes
              connections.nodes.forEach(n => {
                n.caption = getBestNodeCaption(n);
              });
              
              processConnections(node, connections, nvl);
            }
          };
          
          const processSpecificRelationship = async (relType) => {
            // Show loading overlay
            const loadingOverlay = showLoadingOverlay(relType);
            
            try {
              // Process the specific relationship type
              const connections = processRelationshipType(relType, outgoingData, incomingData, node);
              
              // Remove loading overlay
              loadingOverlay.remove();
              
              // Process and display the connections
              processConnections(node, connections, nvl);
            } catch (error) {
              console.error(`Error processing ${relType} relationships:`, error);
              loadingOverlay.remove();
              alert(`Error processing ${relType} relationships: ${error.message}`);
            }
          };
          
          // Create and show the relationship selection dialog
          createRelationshipSelectionDialog(
            node, 
            outgoingData, 
            incomingData, 
            processAllRelationships, 
            processSpecificRelationship
          );
          
        } catch (error) {
          console.error("Error in double-click handler:", error);
          alert(`Error expanding node: ${error.message}`);
        }
      }
    });
    
    // Return all interaction handlers
    return {
      displayProperties,
      clickInteraction,
      panInteraction,
      zoomInteraction,
      dragNodeInteraction
    };
  } catch (error) {
    console.error("Error setting up interactions:", error);
  }
};