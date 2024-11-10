const fs = require('fs');
const path = require('path');

const documentsPath = './alberta-docs-json'; // Path to the JSON files with parsed document content

let documents = [];

// Load JSON documents and index content
function loadDocuments() {
    const files = fs.readdirSync(documentsPath);
    
    documents = files
        .filter(file => path.extname(file).toLowerCase() === '.json') // Only process JSON files
        .map(file => {
            const filePath = path.join(documentsPath, file);
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return {
                fileName: content.fileName,
                numPages: content.numPages,
                text: content.text
            };
        });

    console.log(`Loaded ${documents.length} documents from ${documentsPath}`);
}

// Function to search the indexed documents
function searchDocuments(query) {
    const results = [];

    documents.forEach(doc => {
        if (doc.text.toLowerCase().includes(query.toLowerCase())) {
            // Add document to results if query is found in text
            results.push({
                fileName: doc.fileName,
                snippet: getSnippet(doc.text, query),
                numPages: doc.numPages
            });
        }
    });

    return results.length ? results : [{ snippet: 'No relevant information found.' }];
}

// Helper function to get a snippet of text around the query match
function getSnippet(text, query, snippetLength = 200) {
    const queryIndex = text.toLowerCase().indexOf(query.toLowerCase());
    if (queryIndex === -1) return null;

    const start = Math.max(0, queryIndex - snippetLength / 2);
    const end = Math.min(text.length, queryIndex + snippetLength / 2);

    return text.substring(start, end) + '...';
}

// Initialize by loading documents
loadDocuments();

module.exports = {
    searchDocuments
};
