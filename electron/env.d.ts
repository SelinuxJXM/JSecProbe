/// electron 侧 TS 全局环境补充

// 1) 主/预加载依赖的 adm-zip：官方仓库已自带类型（.d.ts 随 npm 包发布在 node_modules/adm-zip/）。
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
