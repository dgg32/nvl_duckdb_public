import { NVL } from "@neo4j-nvl/base";
import { SERVER_URL, executeQuery } from "./connection";
import { setupInteraction, saveInitialGraphState } from "./interaction";
import './graph-styles.css';

// Store NVL instance reference
let nvlInstance = null;
let interactionHandlers = null;

// Initialize the application
async function initApp() {
  try {
    console.log("Initializing application...");
    const container = document.getElementById("app");
    const cypherInput = document.getElementById("cypher-input");
    
    // Show loading state
    container.innerHTML = '<div style="text-align: center; padding-top: 100px; color: #666;">Loading database information...</div>';
    cypherInput.value = "Loading...";
    cypherInput.disabled = true;
    
    // Fetch the default query from server
    let defaultQuery;
    try {
      const response = await fetch(`${SERVER_URL}/api/default-query`);
      if (!response.ok) {
        throw new Error(`Server returned error: ${response.status}`);
      }
      
      const data = await response.json();
      defaultQuery = data.query;
      
      if (!defaultQuery) {
        throw new Error("Server did not return a valid default query");
      }
      
      console.log("Received default query:", defaultQuery);
    } catch (fetchError) {
      console.error("Error fetching default query:", fetchError);
      // Fall back to a simple default query
      defaultQuery = "FROM GRAPH_TABLE (drug_graph MATCH (a)-[n]->(b) COLUMNS (a, n, b)) LIMIT 5";
      console.log("Using fallback query:", defaultQuery);
    }
    
    // Set up the input field with default query
    cypherInput.value = defaultQuery;
    cypherInput.disabled = false;
    
    // Initial graph rendering
    await renderGraph(defaultQuery, container);
    
    // Setup query execution
    setupQueryExecution(cypherInput, container);
  } catch (error) {
    console.error("Error initializing application:", error);
    alert("Error initializing application. Please check the console for details.");
  }
}

// Function to render the graph based on query results
async function renderGraph(query, container) {
  try {
    // Execute the query
    const { nodes, relationships } = await executeQuery(query);
    
    // Clean up existing instance if it exists
    if (nvlInstance) {
      try {
        // Explicitly remove all event listeners and handlers
        if (interactionHandlers) {
          // Clean up click interaction handlers
          if (interactionHandlers.clickInteraction) {
            interactionHandlers.clickInteraction.updateCallback('onNodeClick', null);
            interactionHandlers.clickInteraction.updateCallback('onRelationshipClick', null);
            interactionHandlers.clickInteraction.updateCallback('onNodeDoubleClick', null);
            interactionHandlers.clickInteraction.updateCallback('onBackgroundClick', null);
          }
          
          // Clean up drag node interaction
          if (interactionHandlers.dragNodeInteraction && 
              typeof interactionHandlers.dragNodeInteraction.resetState === 'function') {
            interactionHandlers.dragNodeInteraction.resetState();
          }
          
          // Optional: explicitly clean up other interactions if they have cleanup methods
          ['panInteraction', 'zoomInteraction', 'dragNodeInteraction'].forEach(interaction => {
            if (interactionHandlers[interaction] && 
                typeof interactionHandlers[interaction].destroy === 'function') {
              try {
                interactionHandlers[interaction].destroy();
              } catch (e) {
                console.warn(`Error destroying ${interaction}:`, e);
              }
            }
          });
        }
        
        // Remove global references
        window.displayNodeProperties = null;
        window.displayRelationshipProperties = null;
        
        // Remove any canvas event listeners added in setupInteraction
        const canvas = nvlInstance.getContainer().querySelector('canvas');
        if (canvas) {
          // Use a clone to avoid modification during iteration
          const newCanvas = canvas.cloneNode(true);
          if (canvas.parentNode) {
            canvas.parentNode.replaceChild(newCanvas, canvas);
          }
        }
        
        // Destroy the NVL instance
        nvlInstance.destroy();
        nvlInstance = null;
        interactionHandlers = null;
      } catch (destroyError) {
        console.warn("Error while cleaning up previous graph:", destroyError);
        // Continue with creating a new instance
      }
    }
    
    // Clear the container's contents
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    
    // Create new NVL instance with error handling
    if (!nodes || !relationships) {
      throw new Error("Invalid query results: missing nodes or relationships");
    }
    
    if (nodes.length === 0 && relationships.length === 0) {
      // Create empty visualization with a message
      container.innerHTML = '<div style="text-align: center; padding-top: 100px; color: #666;">No data returned by query</div>';
      return null;
    }
    
    // Create new NVL instance
    nvlInstance = new NVL(container, nodes, relationships, { initialZoom: 2.6 });
    
    // Store the NVL instance globally (if needed for external access)
    window.nvlInstance = nvlInstance;
    
    // Set up interactions with the new instance
    interactionHandlers = setupInteraction(nvlInstance);
    
    // Save initial graph state to track original nodes
    saveInitialGraphState(nvlInstance);
    
    return nvlInstance;
  } catch (error) {
    console.error("Error rendering graph:", error);
    container.innerHTML = `<div style="text-align: center; padding-top: 100px; color: #666;">
      Error rendering visualization:<br>${error.message || "Unknown error"}</div>`;
    return null;
  }
}

// Setup query execution functionality
function setupQueryExecution(inputElement, container) {
  const runButton = document.getElementById("run-query");
  
  // Function to execute the query
  const runQuery = async () => {
    try {
      const query = inputElement.value.trim();
      if (!query) {
        alert("Please enter a Cypher query");
        return;
      }
      
      // Update UI to show query is running
      runButton.textContent = "Running...";
      runButton.disabled = true;
      container.innerHTML = '<div style="text-align: center; padding-top: 100px; color: #666;">Loading...</div>';
      
      // Add a delay to ensure UI update is visible
      setTimeout(async () => {
        try {
          // Render new graph based on query
          await renderGraph(query, container);
          
          // Reset button state
          runButton.textContent = "Run";
          runButton.disabled = false;
        } catch (renderError) {
          // Reset button state
          runButton.textContent = "Run";
          runButton.disabled = false;
          
          // Show error
          console.error("Error executing query:", renderError);
          alert(`Error executing query: ${renderError.message || renderError}`);
        }
      }, 50);
    } catch (error) {
      // Reset button state
      runButton.textContent = "Run";
      runButton.disabled = false;
      
      // Show error
      console.error("Error executing query:", error);
      alert(`Error executing query: ${error.message || error}`);
    }
  };
  
  // Run query on button click
  runButton.addEventListener("click", runQuery);
  
  // Run query on Enter key
  inputElement.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runQuery();
    }
  });
}

// Start the application
console.log("Initializing initApp...");
initApp();
console.log("After initApp...");