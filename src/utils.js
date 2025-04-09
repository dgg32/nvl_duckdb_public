// Color palette for node categorization
export const category10 = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];

// Map to track label colors consistently across the application
export const labelColorMap = new Map();

/**
 * Find the best caption for a node based on common naming properties
 * @param {Object} node - Node object with properties
 * @returns {string} Best caption for display
 */
export const getBestNodeCaption = (node) => {
  if (!node) return '';
  
  // If caption is already set and not just the ID, use it
  if (node.caption && node.caption !== node.id) {
    return node.caption;
  }
  
  // Check for name property directly on node
  if (node.name) {
    return node.name;
  }
  
  // Check for common name properties in order of preference
  if (node.properties) {
    const nameProps = [
      'name', 'title', 'label', 'display_name', 
      'drug_name', 'generic_name', 'brand_name',
      'common_name', 'full_name', 'preferred_name',
      'identifier', 'description'
    ];
    
    for (const prop of nameProps) {
      if (node.properties[prop]) {
        return node.properties[prop];
      }
    }
    
    // If there's any property with 'name' in it, use that as a fallback
    const nameKey = Object.keys(node.properties).find(key => 
      key.toLowerCase().includes('name') && node.properties[key]
    );
    
    if (nameKey) {
      return node.properties[nameKey];
    }
  }
  
  // Fallback to ID
  return node.id;
};

/**
 * Process nodes to add visual properties consistently
 * @param {Array} nodes - Array of nodes to process
 * @returns {Array} Processed nodes with added visual properties
 */
export const processNodes = (nodes) => {
  return nodes.map((node) => {
    const primaryLabel = node.labels && node.labels.length > 0 ? node.labels[0] : 'Unknown';
    
    // Assign color based on label
    if (!labelColorMap.has(primaryLabel)) {
      const colorIndex = labelColorMap.size % category10.length;
      labelColorMap.set(primaryLabel, category10[colorIndex]);
    }
    
    return {
      ...node,
      caption: getBestNodeCaption(node),
      color: labelColorMap.get(primaryLabel)
    };
  });
};

/**
 * Format URLs within text to be clickable
 * @param {string} text - Text to search for URLs
 * @returns {string} Text with URLs converted to HTML links
 */
export const formatUrls = (text) => {
  if (typeof text !== 'string') return text;
  
  // URL regex pattern
  const urlPattern = /https?:\/\/[^\s"'<>]+/g;
  
  // Replace URLs with clickable links
  return text.replace(urlPattern, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
};

/**
 * Format property values for display with Show All toggle for long content
 * @param {any} value - The property value to format
 * @param {string} propKey - The property key (used for element IDs)
 * @returns {string} HTML string with formatted value
 */
export const formatPropertyValue = (value, propKey) => {
  if (value === null || value === undefined) return '<em>null</em>';
  
  // Handle array of values
  if (Array.isArray(value)) {
    // Convert array to formatted string
    const formattedItems = value.map((item) => {
      // Format each item individually
      let itemStr;
      if (typeof item === 'object' && item !== null) {
        try {
          itemStr = JSON.stringify(item);
        } catch (e) {
          itemStr = String(item);
        }
      } else {
        itemStr = String(item);
      }
      return formatUrls(itemStr);
    });
    
    // Join array items with line breaks
    const arrayString = formattedItems.join('<br>');
    
    // Check if joined array is long and needs truncation
    if (arrayString.length > 1000 || value.length > 20) {
      const uniqueId = `arr_${propKey.replace(/[^a-zA-Z0-9]/g, '_')}_${Math.random().toString(36).substring(2, 11)}`;
      
      // Show only first 15 items or content up to 1000 chars
      let truncatedArray;
      if (value.length > 20) {
        // If there are many items, show first 15
        truncatedArray = formattedItems.slice(0, 15).join('<br>');
        truncatedArray += `<br>... (${value.length - 15} more items)`;
      } else {
        // Otherwise truncate based on total length
        truncatedArray = arrayString.substring(0, 1000) + '...';
      }
      
      return `
        <div>
          <div id="${uniqueId}_short" class="truncated-content">${truncatedArray}</div>
          <div id="${uniqueId}_full" class="full-content" style="display: none;">${arrayString}</div>
          <button class="toggle-content-btn" 
                  onclick="(function() { 
                    document.getElementById('${uniqueId}_short').style.display = 'none';
                    document.getElementById('${uniqueId}_full').style.display = 'block';
                    this.style.display = 'none';
                    return false;
                  }).call(this)">Show all ${value.length} items</button>
        </div>
      `;
    }
    
    return arrayString;
  }
  
  // Convert to string
  let stringValue;
  
  if (typeof value === 'object' && value !== null) {
    try {
      stringValue = JSON.stringify(value);
    } catch (e) {
      stringValue = String(value);
    }
  } else {
    stringValue = String(value);
  }
  
  // Format URLs
  const formattedValue = formatUrls(stringValue);
  
  // Check if content is long and needs truncation
  if (formattedValue.length > 1000) {
    const truncatedValue = formattedValue.substring(0, 1000);
    const uniqueId = `prop_${propKey.replace(/[^a-zA-Z0-9]/g, '_')}_${Math.random().toString(36).substring(2, 11)}`;
    
    return `
      <div>
        <div id="${uniqueId}_short" class="truncated-content">${truncatedValue}...</div>
        <div id="${uniqueId}_full" class="full-content" style="display: none;">${formattedValue}</div>
        <button class="toggle-content-btn" 
                onclick="(function() { 
                  document.getElementById('${uniqueId}_short').style.display = 'none';
                  document.getElementById('${uniqueId}_full').style.display = 'block';
                  this.style.display = 'none';
                  return false;
                }).call(this)">Show all</button>
      </div>
    `;
  }
  
  return formattedValue;
};

/**
 * Show a transient notification message that disappears after a delay
 * @param {string} message - The message to display
 * @param {number} [duration=3000] - How long to show the message in milliseconds
 */
export const showNotification = (message, duration = 3000) => {
  // Find the visualization container
  const graphContainer = document.querySelector('#app');
  if (!graphContainer) {
    console.warn('Graph container not found for notification');
    return; // Exit if we can't find the container
  }
  
  // Create notification container if it doesn't exist yet
  let notificationContainer = document.getElementById('graph-notifications');
if (!notificationContainer) {
  notificationContainer = document.createElement('div');
  notificationContainer.id = 'graph-notifications';
  graphContainer.appendChild(notificationContainer);
}
  
  // Create notification element
  const notification = document.createElement('div');
  notification.className = 'graph-notification';
  notification.textContent = message;
  
  // Add to container
  notificationContainer.appendChild(notification);
  
  // Trigger animation
  setTimeout(() => {
    notification.style.opacity = '1';
  }, 50);
  
  // Remove after duration
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
      
      // If no more notifications, remove container
      if (notificationContainer.children.length === 0) {
        notificationContainer.remove();
      }
    }, 300); // Wait for fade out animation
  }, duration);
};


// Helper function to display properties in the panel
export const displayProperties = async (element, elementType) => {
      // Get properties panel elements
  const propertiesContent = document.getElementById('properties-content');

  if (!propertiesContent) {
    console.error("Properties content element not found");
    return;
  }

  if (!element) {
    propertiesContent.innerHTML = '<p class="no-selection">Click on a node or relationship to view its properties</p>';
    return;
  }
  
  // Try to get detailed properties from NVL
  let properties = {};
  try {
    if (elementType === 'node') {
      properties = element.properties || {};
    } else if (elementType === 'relationship') {
      properties = element.properties || {};
    }
  } catch (error) {
    console.warn('Could not get detailed properties:', error);
    // Use what we already have from the element
    properties = element.properties || {};
  }
  
  // Create properties table
  let displayName = element.caption || element.id;
  if (elementType === 'node') {
    displayName = getBestNodeCaption(element);
  }
  
  let html = `
    <h3>${elementType === 'node' ? 'Node' : 'Relationship'}: ${displayName}</h3>
    <table class="property-table">
      <tr>
        <th>Property</th>
        <th>Value</th>
      </tr>
  `;
  
  // Special fields for nodes
  if (elementType === 'node' && element.labels && element.labels.length > 0) {
    html += `
      <tr>
        <td><strong>Labels</strong></td>
        <td>${element.labels.join(', ')}</td>
      </tr>
    `;
  }
  
  // Special fields for relationships
  if (elementType === 'relationship') {
    console.log('in relationship, element', element);
    html += `
      <tr>
        <td><strong>Type</strong></td>
        <td>${element.caption || 'Unknown'}</td>
      </tr>
      <tr>
        <td><strong>From</strong></td>
        <td>${element.from || 'Unknown'}</td>
      </tr>
      <tr>
        <td><strong>To</strong></td>
        <td>${element.to || 'Unknown'}</td>
      </tr>
    `;
  }
  
  // Add all properties - SORT ALPHABETICALLY
  let hasProperties = false;
  
  // Get all property keys and sort them alphabetically
  const sortedKeys = Object.keys(properties)
    .filter(key => !key.startsWith('_')) // Skip internal properties
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })); // Case-insensitive sort
  
  // Add properties in sorted order
  for (const key of sortedKeys) {
    let value = properties[key];
    
    // For node name property, if it matches the ID, use the best caption instead
    if (elementType === 'node' && key === 'name' && value === element.id) {
      value = getBestNodeCaption(element);
    }
    
    hasProperties = true;
    html += `
      <tr>
        <td>${key}</td>
        <td>${formatPropertyValue(value, key)}</td>
      </tr>
    `;
  }
  
  // If no properties, show a message
  if (!hasProperties) {
    html += `
      <tr>
        <td colspan="2">No properties found</td>
      </tr>
    `;
  }
  
  html += '</table>';
  propertiesContent.innerHTML = html;
  
  // Add click event listener to make sure links work properly
  const links = propertiesContent.querySelectorAll('a');
  links.forEach(link => {
    link.addEventListener('click', (event) => {
      event.stopPropagation(); // Prevent the container click event
      // The target="_blank" attribute will open the link in a new tab
    });
  });
};
