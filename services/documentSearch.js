// services/documentSearch.js
const fs = require('fs');
const path = require('path');

const documentDirectory = path.join(__dirname, '../alberta-docs-json');
let documents = [];

function loadDocuments() {
  const files = fs.readdirSync(documentDirectory);
  documents = files.map(file => {
    const filePath = path.join(documentDirectory, file);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return {
      fileName: content.fileName,
      text: content.text,
    };
  });
}

function searchDocuments(query) {
  const results = documents.filter(doc => doc.text.toLowerCase().includes(query.toLowerCase()));
  return results.map(result => ({
    fileName: result.fileName,
    snippet: result.text.substring(0, 100) + '...', // Return the first 100 chars as a snippet
  }));
}

loadDocuments(); // Load docs into memory on server start

module.exports = {
  searchDocuments,
};
