@echo off
robocopy "D:\Claude\crm-app" "C:\Users\Stavros\Desktop\Backup\crm-app" /E /XD node_modules .git dist out /R:3 /W:5
echo Backup complete!
pause
