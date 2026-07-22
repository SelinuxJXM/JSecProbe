import re

with open('electron/ipc/system.ipc.ts', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("}), 'system');", "}), 'system'));")

with open('electron/ipc/system.ipc.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('修复完成')
