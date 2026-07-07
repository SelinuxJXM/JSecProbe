/**
 * 资产类型与不适用测评项映射表
 * 从S2A2G2.xlsx提取
 * 
 * 当选择特定资产类型时，对应的测评项自动标记为"不适用"
 */

export interface NaItem {
  controlPoint: string;
  requirement: string;
  extensionType: string;
}

export const ASSET_NA_MAPPING: Record<string, NaItem[]> = {
  "network_device": [
    {
      "controlPoint": "入侵防范",
      "requirement": "d）应提供数据有效性检验功能，保证通过人机接口输入或通过通信接口输入的内容符合系统设定要求；",
      "extensionType": "general"
    },
    {
      "controlPoint": "恶意代码防范",
      "requirement": "a）应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。",
      "extensionType": "general"
    },
    {
      "controlPoint": "剩余信息保护",
      "requirement": "a）应保证鉴别信息所在的存储空间被释放或重新分配前得到完全清除。",
      "extensionType": "general"
    },
    {
      "controlPoint": "个人信息保护",
      "requirement": "a）应仅采集和保存业务必需的用户个人信息；",
      "extensionType": "general"
    },
    {
      "controlPoint": "个人信息保护",
      "requirement": "b）应禁止未授权访问和非法使用用户个人信息。",
      "extensionType": "general"
    }
  ],
  "security_device": [
    {
      "controlPoint": "入侵防范",
      "requirement": "d）应提供数据有效性检验功能，保证通过人机接口输入或通过通信接口输入的内容符合系统设定要求；",
      "extensionType": "general"
    },
    {
      "controlPoint": "恶意代码防范",
      "requirement": "a）应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。",
      "extensionType": "general"
    },
    {
      "controlPoint": "剩余信息保护",
      "requirement": "a）应保证鉴别信息所在的存储空间被释放或重新分配前得到完全清除。",
      "extensionType": "general"
    },
    {
      "controlPoint": "个人信息保护",
      "requirement": "a）应仅采集和保存业务必需的用户个人信息；",
      "extensionType": "general"
    },
    {
      "controlPoint": "个人信息保护",
      "requirement": "b）应禁止未授权访问和非法使用用户个人信息。",
      "extensionType": "general"
    }
  ],
  "business_app": [
    {
      "controlPoint": "入侵防范",
      "requirement": "a）应遵循最小安装的原则，仅安装需要的组件和应用程序；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "b）应关闭不需要的系统服务、默认共享和高危端口；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "c）应通过设定终端接入方式或网络地址范围对通过网络进行管理的管理终端进行限制；",
      "extensionType": "general"
    },
    {
      "controlPoint": "恶意代码防范",
      "requirement": "a）应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。",
      "extensionType": "general"
    }
  ],
  "management_platform": [
    {
      "controlPoint": "入侵防范",
      "requirement": "a）应遵循最小安装的原则，仅安装需要的组件和应用程序；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "b）应关闭不需要的系统服务、默认共享和高危端口；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "c）应通过设定终端接入方式或网络地址范围对通过网络进行管理的管理终端进行限制；",
      "extensionType": "general"
    },
    {
      "controlPoint": "恶意代码防范",
      "requirement": "a）应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。",
      "extensionType": "general"
    },
    {
      "controlPoint": "个人信息保护",
      "requirement": "a）应仅采集和保存业务必需的用户个人信息；",
      "extensionType": "general"
    },
    {
      "controlPoint": "个人信息保护",
      "requirement": "b）应禁止未授权访问和非法使用用户个人信息。",
      "extensionType": "general"
    }
  ],
  "server_storage": [
    {
      "controlPoint": "入侵防范",
      "requirement": "d）应提供数据有效性检验功能，保证通过人机接口输入或通过通信接口输入的内容符合系统设定要求；",
      "extensionType": "general"
    },
    {
      "controlPoint": "个人信息保护",
      "requirement": "a）应仅采集和保存业务必需的用户个人信息；",
      "extensionType": "general"
    },
    {
      "controlPoint": "个人信息保护",
      "requirement": "b）应禁止未授权访问和非法使用用户个人信息。",
      "extensionType": "general"
    }
  ],
  "dbms": [
    {
      "controlPoint": "入侵防范",
      "requirement": "a）应遵循最小安装的原则，仅安装需要的组件和应用程序；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "b）应关闭不需要的系统服务、默认共享和高危端口；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "c）应通过设定终端接入方式或网络地址范围对通过网络进行管理的管理终端进行限制；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "d）应提供数据有效性检验功能，保证通过人机接口输入或通过通信接口输入的内容符合系统设定要求；",
      "extensionType": "general"
    },
    {
      "controlPoint": "恶意代码防范",
      "requirement": "a）应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。",
      "extensionType": "general"
    }
  ],
  "terminal": [
    {
      "controlPoint": "入侵防范",
      "requirement": "d）应提供数据有效性检验功能，保证通过人机接口输入或通过通信接口输入的内容符合系统设定要求；",
      "extensionType": "general"
    },
    {
      "controlPoint": "个人信息保护",
      "requirement": "a）应仅采集和保存业务必需的用户个人信息；",
      "extensionType": "general"
    },
    {
      "controlPoint": "个人信息保护",
      "requirement": "b）应禁止未授权访问和非法使用用户个人信息。",
      "extensionType": "general"
    }
  ],
  "data_auth": [
    {
      "controlPoint": "身份鉴别",
      "requirement": "a）应对登录的用户进行身份标识和鉴别，身份标识具有唯一性，身份鉴别信息具有复杂度要求并定期更换；",
      "extensionType": "general"
    },
    {
      "controlPoint": "身份鉴别",
      "requirement": "b）应具有登录失败处理功能，应配置并启用结束会话、限制非法登录次数和当登录连接超时自动退出等相关措施；",
      "extensionType": "general"
    },
    {
      "controlPoint": "身份鉴别",
      "requirement": "c）当进行远程管理时，应采取必要措施防止鉴别信息在网络传输过程中被窃听。",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "a）应对登录的用户分配账户和权限；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "b）应重命名或删除默认账户，修改默认账户的默认口令；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "c）应及时删除或停用多余的、过期的账户，避免共享账户的存在；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "d）应授予管理用户所需的最小权限，实现管理用户的权限分离。",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "a）应启用安全审计功能，审计覆盖到每个用户，对重要的用户行为和重要安全事件进行审计；",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "b）审计记录应包括事件的日期和时间、用户、事件类型、事件是否成功及其他与审计相关的信息；",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "c）应对审计记录进行保护，定期备份，避免受到未预期的删除、修改或覆盖等。",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "a）应遵循最小安装的原则，仅安装需要的组件和应用程序；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "b）应关闭不需要的系统服务、默认共享和高危端口；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "c）应通过设定终端接入方式或网络地址范围对通过网络进行管理的管理终端进行限制；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "d）应提供数据有效性检验功能，保证通过人机接口输入或通过通信接口输入的内容符合系统设定要求；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "e）应能发现可能存在的已知漏洞，并在经过充分测试评估后，及时修补漏洞。",
      "extensionType": "general"
    },
    {
      "controlPoint": "恶意代码防范",
      "requirement": "a）应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。",
      "extensionType": "general"
    },
    {
      "controlPoint": "可信验证",
      "requirement": "a）可基于可信根对计算设备的系统引导程序、系统程序、重要配置参数和应用程序等进行可信验证，并在检测到其可信性受到破坏后进行报警，并将验证结果形成审计记录送至安全管理中心。",
      "extensionType": "general"
    }
  ],
  "data_business": [
    {
      "controlPoint": "身份鉴别",
      "requirement": "a）应对登录的用户进行身份标识和鉴别，身份标识具有唯一性，身份鉴别信息具有复杂度要求并定期更换；",
      "extensionType": "general"
    },
    {
      "controlPoint": "身份鉴别",
      "requirement": "b）应具有登录失败处理功能，应配置并启用结束会话、限制非法登录次数和当登录连接超时自动退出等相关措施；",
      "extensionType": "general"
    },
    {
      "controlPoint": "身份鉴别",
      "requirement": "c）当进行远程管理时，应采取必要措施防止鉴别信息在网络传输过程中被窃听。",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "a）应对登录的用户分配账户和权限；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "b）应重命名或删除默认账户，修改默认账户的默认口令；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "c）应及时删除或停用多余的、过期的账户，避免共享账户的存在；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "d）应授予管理用户所需的最小权限，实现管理用户的权限分离。",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "a）应启用安全审计功能，审计覆盖到每个用户，对重要的用户行为和重要安全事件进行审计；",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "b）审计记录应包括事件的日期和时间、用户、事件类型、事件是否成功及其他与审计相关的信息；",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "c）应对审计记录进行保护，定期备份，避免受到未预期的删除、修改或覆盖等。",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "a）应遵循最小安装的原则，仅安装需要的组件和应用程序；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "b）应关闭不需要的系统服务、默认共享和高危端口；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "c）应通过设定终端接入方式或网络地址范围对通过网络进行管理的管理终端进行限制；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "d）应提供数据有效性检验功能，保证通过人机接口输入或通过通信接口输入的内容符合系统设定要求；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "e）应能发现可能存在的已知漏洞，并在经过充分测试评估后，及时修补漏洞。",
      "extensionType": "general"
    },
    {
      "controlPoint": "恶意代码防范",
      "requirement": "a）应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。",
      "extensionType": "general"
    },
    {
      "controlPoint": "可信验证",
      "requirement": "a）可基于可信根对计算设备的系统引导程序、系统程序、重要配置参数和应用程序等进行可信验证，并在检测到其可信性受到破坏后进行报警，并将验证结果形成审计记录送至安全管理中心。",
      "extensionType": "general"
    }
  ],
  "data_audit": [
    {
      "controlPoint": "身份鉴别",
      "requirement": "a）应对登录的用户进行身份标识和鉴别，身份标识具有唯一性，身份鉴别信息具有复杂度要求并定期更换；",
      "extensionType": "general"
    },
    {
      "controlPoint": "身份鉴别",
      "requirement": "b）应具有登录失败处理功能，应配置并启用结束会话、限制非法登录次数和当登录连接超时自动退出等相关措施；",
      "extensionType": "general"
    },
    {
      "controlPoint": "身份鉴别",
      "requirement": "c）当进行远程管理时，应采取必要措施防止鉴别信息在网络传输过程中被窃听。",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "a）应对登录的用户分配账户和权限；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "b）应重命名或删除默认账户，修改默认账户的默认口令；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "c）应及时删除或停用多余的、过期的账户，避免共享账户的存在；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "d）应授予管理用户所需的最小权限，实现管理用户的权限分离。",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "a）应启用安全审计功能，审计覆盖到每个用户，对重要的用户行为和重要安全事件进行审计；",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "b）审计记录应包括事件的日期和时间、用户、事件类型、事件是否成功及其他与审计相关的信息；",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "c）应对审计记录进行保护，定期备份，避免受到未预期的删除、修改或覆盖等。",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "a）应遵循最小安装的原则，仅安装需要的组件和应用程序；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "b）应关闭不需要的系统服务、默认共享和高危端口；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "c）应通过设定终端接入方式或网络地址范围对通过网络进行管理的管理终端进行限制；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "d）应提供数据有效性检验功能，保证通过人机接口输入或通过通信接口输入的内容符合系统设定要求；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "e）应能发现可能存在的已知漏洞，并在经过充分测试评估后，及时修补漏洞。",
      "extensionType": "general"
    },
    {
      "controlPoint": "恶意代码防范",
      "requirement": "a）应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。",
      "extensionType": "general"
    },
    {
      "controlPoint": "可信验证",
      "requirement": "a）可基于可信根对计算设备的系统引导程序、系统程序、重要配置参数和应用程序等进行可信验证，并在检测到其可信性受到破坏后进行报警，并将验证结果形成审计记录送至安全管理中心。",
      "extensionType": "general"
    }
  ],
  "data_config": [
    {
      "controlPoint": "身份鉴别",
      "requirement": "a）应对登录的用户进行身份标识和鉴别，身份标识具有唯一性，身份鉴别信息具有复杂度要求并定期更换；",
      "extensionType": "general"
    },
    {
      "controlPoint": "身份鉴别",
      "requirement": "b）应具有登录失败处理功能，应配置并启用结束会话、限制非法登录次数和当登录连接超时自动退出等相关措施；",
      "extensionType": "general"
    },
    {
      "controlPoint": "身份鉴别",
      "requirement": "c）当进行远程管理时，应采取必要措施防止鉴别信息在网络传输过程中被窃听。",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "a）应对登录的用户分配账户和权限；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "b）应重命名或删除默认账户，修改默认账户的默认口令；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "c）应及时删除或停用多余的、过期的账户，避免共享账户的存在；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "d）应授予管理用户所需的最小权限，实现管理用户的权限分离。",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "a）应启用安全审计功能，审计覆盖到每个用户，对重要的用户行为和重要安全事件进行审计；",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "b）审计记录应包括事件的日期和时间、用户、事件类型、事件是否成功及其他与审计相关的信息；",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "c）应对审计记录进行保护，定期备份，避免受到未预期的删除、修改或覆盖等。",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "a）应遵循最小安装的原则，仅安装需要的组件和应用程序；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "b）应关闭不需要的系统服务、默认共享和高危端口；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "c）应通过设定终端接入方式或网络地址范围对通过网络进行管理的管理终端进行限制；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "d）应提供数据有效性检验功能，保证通过人机接口输入或通过通信接口输入的内容符合系统设定要求；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "e）应能发现可能存在的已知漏洞，并在经过充分测试评估后，及时修补漏洞。",
      "extensionType": "general"
    },
    {
      "controlPoint": "恶意代码防范",
      "requirement": "a）应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。",
      "extensionType": "general"
    },
    {
      "controlPoint": "可信验证",
      "requirement": "a）可基于可信根对计算设备的系统引导程序、系统程序、重要配置参数和应用程序等进行可信验证，并在检测到其可信性受到破坏后进行报警，并将验证结果形成审计记录送至安全管理中心。",
      "extensionType": "general"
    }
  ],
  "data_video": [
    {
      "controlPoint": "身份鉴别",
      "requirement": "a）应对登录的用户进行身份标识和鉴别，身份标识具有唯一性，身份鉴别信息具有复杂度要求并定期更换；",
      "extensionType": "general"
    },
    {
      "controlPoint": "身份鉴别",
      "requirement": "b）应具有登录失败处理功能，应配置并启用结束会话、限制非法登录次数和当登录连接超时自动退出等相关措施；",
      "extensionType": "general"
    },
    {
      "controlPoint": "身份鉴别",
      "requirement": "c）当进行远程管理时，应采取必要措施防止鉴别信息在网络传输过程中被窃听。",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "a）应对登录的用户分配账户和权限；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "b）应重命名或删除默认账户，修改默认账户的默认口令；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "c）应及时删除或停用多余的、过期的账户，避免共享账户的存在；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "d）应授予管理用户所需的最小权限，实现管理用户的权限分离。",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "a）应启用安全审计功能，审计覆盖到每个用户，对重要的用户行为和重要安全事件进行审计；",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "b）审计记录应包括事件的日期和时间、用户、事件类型、事件是否成功及其他与审计相关的信息；",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "c）应对审计记录进行保护，定期备份，避免受到未预期的删除、修改或覆盖等。",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "a）应遵循最小安装的原则，仅安装需要的组件和应用程序；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "b）应关闭不需要的系统服务、默认共享和高危端口；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "c）应通过设定终端接入方式或网络地址范围对通过网络进行管理的管理终端进行限制；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "d）应提供数据有效性检验功能，保证通过人机接口输入或通过通信接口输入的内容符合系统设定要求；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "e）应能发现可能存在的已知漏洞，并在经过充分测试评估后，及时修补漏洞。",
      "extensionType": "general"
    },
    {
      "controlPoint": "恶意代码防范",
      "requirement": "a）应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。",
      "extensionType": "general"
    },
    {
      "controlPoint": "可信验证",
      "requirement": "a）可基于可信根对计算设备的系统引导程序、系统程序、重要配置参数和应用程序等进行可信验证，并在检测到其可信性受到破坏后进行报警，并将验证结果形成审计记录送至安全管理中心。",
      "extensionType": "general"
    }
  ],
  "data_personal": [
    {
      "controlPoint": "身份鉴别",
      "requirement": "a）应对登录的用户进行身份标识和鉴别，身份标识具有唯一性，身份鉴别信息具有复杂度要求并定期更换；",
      "extensionType": "general"
    },
    {
      "controlPoint": "身份鉴别",
      "requirement": "b）应具有登录失败处理功能，应配置并启用结束会话、限制非法登录次数和当登录连接超时自动退出等相关措施；",
      "extensionType": "general"
    },
    {
      "controlPoint": "身份鉴别",
      "requirement": "c）当进行远程管理时，应采取必要措施防止鉴别信息在网络传输过程中被窃听。",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "a）应对登录的用户分配账户和权限；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "b）应重命名或删除默认账户，修改默认账户的默认口令；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "c）应及时删除或停用多余的、过期的账户，避免共享账户的存在；",
      "extensionType": "general"
    },
    {
      "controlPoint": "访问控制",
      "requirement": "d）应授予管理用户所需的最小权限，实现管理用户的权限分离。",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "a）应启用安全审计功能，审计覆盖到每个用户，对重要的用户行为和重要安全事件进行审计；",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "b）审计记录应包括事件的日期和时间、用户、事件类型、事件是否成功及其他与审计相关的信息；",
      "extensionType": "general"
    },
    {
      "controlPoint": "安全审计",
      "requirement": "c）应对审计记录进行保护，定期备份，避免受到未预期的删除、修改或覆盖等。",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "a）应遵循最小安装的原则，仅安装需要的组件和应用程序；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "b）应关闭不需要的系统服务、默认共享和高危端口；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "c）应通过设定终端接入方式或网络地址范围对通过网络进行管理的管理终端进行限制；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "d）应提供数据有效性检验功能，保证通过人机接口输入或通过通信接口输入的内容符合系统设定要求；",
      "extensionType": "general"
    },
    {
      "controlPoint": "入侵防范",
      "requirement": "e）应能发现可能存在的已知漏洞，并在经过充分测试评估后，及时修补漏洞。",
      "extensionType": "general"
    },
    {
      "controlPoint": "恶意代码防范",
      "requirement": "a）应安装防恶意代码软件或配置具有相应功能的软件，并定期进行升级和更新防恶意代码库。",
      "extensionType": "general"
    },
    {
      "controlPoint": "可信验证",
      "requirement": "a）可基于可信根对计算设备的系统引导程序、系统程序、重要配置参数和应用程序等进行可信验证，并在检测到其可信性受到破坏后进行报警，并将验证结果形成审计记录送至安全管理中心。",
      "extensionType": "general"
    }
  ]
};

// 资产类别名称映射
export const ASSET_CATEGORY_NAMES: Record<string, string> = {
  network_device: '网络设备',
  security_device: '安全设备',
  server_storage: '服务器/存储设备',
  dbms: '数据库管理系统',
  management_platform: '系统管理平台',
  business_app: '业务应用系统',
  terminal: '业务终端/运维终端',
  data_auth: '鉴别数据',
  data_business: '重要业务数据',
  data_audit: '重要审计数据',
  data_config: '重要配置数据',
  data_video: '重要视频数据',
  data_personal: '重要个人信息',
};
