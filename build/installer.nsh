; 火影忍者Online 启动器 · 卸载钩子
;
; 背景：electron-builder 的 NSIS 卸载器默认不删 %APPDATA% 下的用户数据，
;       而 captures/ 每次抓包都会新增一个 netlog（单个可达数百 MB）。
;
; 策略：
;   1. 可再生成的大缓存（抓包 / 分区 / 各类 Cache）—— 无条件删除；
;   2. 账号与设置（accounts.json / config.json）—— 弹框询问，用户选「否」就保留；
;   3. 静默卸载（/S）不弹框，保留账号与设置（最安全）。
;
; 注意：这里显式写死目录名 naruto-online-launcher（= package.json 的 name，
;       也是 Electron 默认 userData 目录名），不依赖 electron-builder 的推导。

!macro customUnInstall
  ; ① 可再生成的大文件 / 缓存：无条件删除
  RMDir /r "$APPDATA\naruto-online-launcher\captures"
  RMDir /r "$APPDATA\naruto-online-launcher\Partitions"
  RMDir /r "$APPDATA\naruto-online-launcher\Cache"
  RMDir /r "$APPDATA\naruto-online-launcher\GPUCache"
  RMDir /r "$APPDATA\naruto-online-launcher\Code Cache"
  RMDir /r "$APPDATA\naruto-online-launcher\Dictionaries"
  RMDir /r "$APPDATA\naruto-online-launcher\blob_storage"
  RMDir /r "$APPDATA\naruto-online-launcher\Session Storage"
  RMDir /r "$APPDATA\naruto-online-launcher\Local Storage"
  RMDir /r "$APPDATA\naruto-online-launcher\Service Worker"
  RMDir /r "$APPDATA\naruto-online-launcher\shared_proto_db"
  Delete "$APPDATA\naruto-online-launcher\*.log"

  ; ② 账号 / 设置：问一次
  IfSilent naruto_keep_userdata
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除本地保存的账号与设置？$\r$\n$\r$\n选「否」会保留，方便以后重新安装继续使用。" IDNO naruto_keep_userdata
  RMDir /r "$APPDATA\naruto-online-launcher"

  naruto_keep_userdata:
!macroend
