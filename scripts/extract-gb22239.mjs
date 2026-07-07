import fs from 'fs';
import * as PdfParse from 'pdf-parse';

const pdfPath = 'E:\\2-进阶培训考试\\等保测评师考试\\《信息安全技术网络安全等级保护基本要求》（GB_T22239-2019）.pdf';
const outputPath = 'f:\\4-编程项目\\1-现场测评工具\\开发源代码\\gb22239-content.txt';

async function main() {
  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await PdfParse.default(dataBuffer);
  
  fs.writeFileSync(outputPath, data.text, 'utf-8');
  console.log(`PDF提取完成，共 ${data.numpages} 页`);
  console.log(`输出文件: ${outputPath}`);
  console.log(`文本长度: ${data.text.length} 字符`);
}

main().catch(console.error);
