// services/documentSearch.js
const fs = require('fs');
const path = require('path');

function searchDocuments(query) {
  const results = [];
  const dataDir = path.join(__dirname, '../alberta-docs-json');

  const phrases = extractPhrases(query);
  const phraseRegex = new RegExp(`(${phrases.join('|')})`, 'i'); // Match exact phrases or keywords

  fs.readdirSync(dataDir).forEach((file) => {
    const filePath = path.join(dataDir, file);
    const document = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Match only if document contains any key phrase
    const paragraph = extractRelevantParagraph(document.text, phrases);
    if (paragraph && calculateRelevanceScore(paragraph, phrases) > 30) { // Use a threshold score
      results.push({
        fileName: document.fileName,
        paragraph,
        score: calculateRelevanceScore(paragraph, phrases),
      });
    }
  });

  // Sort by relevance and filter results to exclude low relevance ones
  results.sort((a, b) => b.score - a.score);
  return results.length > 0 ? results.slice(0, 1) : []; // Return top result only if it passes threshold
}

// Helper function to extract phrases based on multiple patterns
function extractPhrases(query) {
  const quotedPhrases = Array.from(query.matchAll(/"([^"]+)"/g), m => m[1]);
  const commaSeparatedPhrases = query.split(',').map(phrase => phrase.trim());
  const words = query.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(word => word.length > 2);
  return [...new Set([...quotedPhrases, ...commaSeparatedPhrases, ...words])];
}

// Extract the paragraph containing the phrase
function extractRelevantParagraph(text, phrases) {
  const phraseRegex = new RegExp(`(.{0,500})(${phrases.join('|')})(.{0,500})`, 'i'); // Larger range for matching

  const match = text.match(phraseRegex);
  if (match) {
    const start = Math.max(0, match.index - 100); // To capture the full paragraph start
    const end = Math.min(text.length, match.index + match[0].length + 100);
    const paragraph = text.substring(start, end);

    // Expand to the full paragraph boundaries
    const fullParagraph = paragraph.match(/(?:\S.*?)[.!?](?:\s|$)/g);
    return fullParagraph ? fullParagraph.join(" ") : paragraph.trim();
  }
  return null;
}

// Calculate relevance score based on phrase frequency
function calculateRelevanceScore(snippet, phrases) {
  let score = 0;
  phrases.forEach((phrase) => {
    const phraseRegex = new RegExp(phrase, 'gi');
    score += (snippet.match(phraseRegex) || []).length * 10;
  });
  return score;
}

module.exports = { searchDocuments };
