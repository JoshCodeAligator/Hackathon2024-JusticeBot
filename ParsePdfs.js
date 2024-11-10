const fs = require('fs');
const pdfParse = require('pdf-parse');
const path = require('path');

// Function to parse a PDF and save the output as a JSON file
async function parsePdfToJson(pdfPath, outputPath) {
    try {
        const pdfBuffer = fs.readFileSync(pdfPath); // Read the PDF file
        const data = await pdfParse(pdfBuffer);     // Extract text from the PDF

        // Organize text by splitting by headings or keywords if needed
        const documentData = {
            fileName: path.basename(pdfPath),
            numPages: data.numpages,
            text: data.text
        };

        // Save the parsed text into a JSON file
        fs.writeFileSync(outputPath, JSON.stringify(documentData, null, 2));
        console.log(`Parsed and saved: ${outputPath}`);
    } catch (error) {
        console.error(`Error processing ${pdfPath}:`, error);
    }
}

// Function to parse all PDFs in the hardcoded input directory
async function parseAllPdfsInDirectory() {
    const inputDir = './input_pdfs';           // Hardcoded input directory
    const outputDir = './alberta-docs-json';    // Hardcoded output directory

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true }); // Create output directory if it doesn't exist
    }

    const files = fs.readdirSync(inputDir);
    for (const file of files) {
        const filePath = path.join(inputDir, file);
        const outputFilePath = path.join(outputDir, `${path.parse(file).name}.json`);

        if (path.extname(file).toLowerCase() === '.pdf') {
            await parsePdfToJson(filePath, outputFilePath);
        }
    }
}

// Start parsing PDFs in the `input_pdfs` folder and save JSONs in the `alberta-docs-json` folder
parseAllPdfsInDirectory()
    .then(() => {
        console.log('Finished parsing all PDFs');
    })
    .catch((error) => {
        console.error('Error parsing PDFs:', error);
    });
