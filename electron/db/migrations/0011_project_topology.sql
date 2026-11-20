-- 系统拓扑图：按被测系统（projects）存储多张拓扑图与 AI 分区分域描述。
-- 附件沿用 attachment:save 的受管相对路径 JSON 格式：[{name,path,size}]，不存 base64。
-- 描述为纯文本，段落间以换行分隔，前端按段落渲染、报告按段落输出。
ALTER TABLE projects ADD COLUMN topology_attachments TEXT;
ALTER TABLE projects ADD COLUMN topology_description TEXT;
