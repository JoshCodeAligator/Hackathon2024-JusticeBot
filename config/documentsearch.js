// services/documentSearch.js
const fs = require('fs');
const path = require('path');

function searchDocuments(query) {
  const results = [];
  const dataDir = path.join(__dirname, '../alberta-docs-json');

  // Extract phrases and keywords from the query
  const phrases = extractPhrases(query);
  const keywords = extractKeywords(query);

  // Create a regular expression to match either phrases or keywords
  const searchPattern = phrases.length > 0 ? phrases.join('|') : keywords.join('|');
  const phraseRegex = new RegExp(`(${searchPattern})`, 'i'); // Match phrases or keywords case-insensitively

  fs.readdirSync(dataDir).forEach((file) => {
    const filePath = path.join(dataDir, file);
    const document = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Match only if document contains any key phrase or keyword
    const paragraph = extractRelevantParagraph(document.text, searchPattern);
    if (paragraph) {
      results.push({
        fileName: document.fileName,
        paragraph,
        score: calculateRelevanceScore(paragraph, phrases, keywords),
      });
    }
  });

  // Sort by relevance score and return top result
  results.sort((a, b) => b.score - a.score);
  return results.length > 0 ? results.slice(0, 1) : [{ message: 'No relevant information found' }];
}

// Helper function to extract phrases based on patterns
function extractPhrases(query) {
  // Extract quoted phrases and comma-separated phrases
  const quotedPhrases = Array.from(query.matchAll(/"([^"]+)"/g), m => m[1]);
  const commaSeparatedPhrases = query.split(',').map(phrase => phrase.trim()).filter(Boolean);
  return [...new Set([...quotedPhrases, ...commaSeparatedPhrases])];
}

// Extract individual keywords for broader matching
function extractKeywords(query) {
  return query.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(word => word.length > 2);
}

// Extract the paragraph containing the phrase or keyword
function extractRelevantParagraph(text, searchPattern) {
  const paragraphRegex = new RegExp(`(.{0,500})(${searchPattern})(.{0,500})`, 'i'); // Expands to capture a paragraph
  const match = text.match(paragraphRegex);
  if (match) {
    return getFullParagraph(text, match.index);
  }
  return null;
}

// Get the full paragraph based on start index
function getFullParagraph(text, index) {
  const before = text.lastIndexOf('.', index) + 1 || 0; // Start from last sentence ending before index
  const after = text.indexOf('.', index + 1) + 1 || text.length; // End at next sentence ending after index
  return text.substring(before, after).replace(/\s+/g, ' ').trim();
}

// Calculate relevance score based on frequency and exact match
function calculateRelevanceScore(text, phrases, keywords) {
  let score = 0;
  phrases.forEach(phrase => {
    const phraseRegex = new RegExp(phrase, 'gi');
    score += (text.match(phraseRegex) || []).length * 20; // Higher score for exact phrases
  });
  keywords.forEach(keyword => {
    const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'gi'); // Word boundary for keyword match
    score += (text.match(keywordRegex) || []).length * 10;
  });
  return score;
}

module.exports = { searchDocuments };
