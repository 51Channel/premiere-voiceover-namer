@echo off
chcp 65001 >nul
rem 双击安装「赫朝录音改名」到这台电脑的 Premiere。装完重启 Premiere。
setlocal
set "HERE=%~dp0"
set "SRC=%HERE%com.hechao.voiceover-namer"
if not exist "%SRC%" set "SRC=%HERE%..\extension\com.hechao.voiceover-namer"
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.hechao.voiceover-namer"

if exist "%DEST%" rmdir /s /q "%DEST%"
xcopy "%SRC%" "%DEST%\" /e /i /q /y >nul || goto :fail

for %%v in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul

if exist "%APPDATA%\Adobe\UXP\Plugins\External\com.hechao.premiere.voiceover-namer" rmdir /s /q "%APPDATA%\Adobe\UXP\Plugins\External\com.hechao.premiere.voiceover-namer"

echo.
echo 装好了。重启 Premiere 就会在后台自动改名。
echo 想看录音列表：窗口 - 扩展 - 赫朝录音改名
pause
exit /b 0
:fail
echo 安装失败：复制文件没成功
pause
exit /b 1
