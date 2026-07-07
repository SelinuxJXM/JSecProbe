const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const pdfPath = 'E:\\2-进阶培训考试\\等保测评师考试\\《信息安全技术网络安全等级保护基本要求》（GB_T22239-2019）.pdf';
const outputPath = 'f:\\4-编程项目\\1-现场测评工具\\开发源代码\\gb22239-content.txt';

async function main() {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  
  let fullText = '';
  const numPages = doc.numPages;
  
  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += `--- Page ${i} ---\n${pageText}\n\n`;
  }
  
  fs.writeFileSync(outputPath, fullText, 'utf-8');
  console.log('PDF提取完成，共', numPages, '页');
  console.log('输出文件:', outputPath);
  console.log('文本长度:', fullText.length, '字符');
}

main().catch(console.error);
