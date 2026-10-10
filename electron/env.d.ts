/// electron 侧 TS 全局环境补充

// 1) Vite 的 ?raw 导入：把文件原样内联为字符串。内置标准 seed（standards.seed.json，约 468KB）
//    靠它做成"用时才 JSON.parse"，避免模块加载时就把整份数据构造成对象常驻内存。
declare module '*.json?raw' {
  const content: string;
  export default content;
}

// 2) 主/预加载依赖的 adm-zip：官方仓库已自带类型（.d.ts 随 npm 包发布在 node_modules/adm-zip/）。
//    如果在某些 Windows + tsc 环境下出现 TS7016（implicit any），就用这份声明兜底，不影响功能。
declare module 'adm-zip' {
  type InputData = Buffer | string | number[] | Uint8Array;

  class AdmZip {
    constructor(input?: InputData);
    addFile(
      entryName: string,
      content: InputData,
      comment?: string,
      attr?: number,
    ): void;
    toBuffer(): Buffer;
  }

  export = AdmZip;
}
