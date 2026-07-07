const pdfParse = require('pdf-parse');
console.log('typeof:', typeof pdfParse);
console.log('keys:', Object.keys(pdfParse));
if (typeof pdfParse === 'object') {
  console.log('default:', typeof pdfParse.default);
}
