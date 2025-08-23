#!/bin/bash
# This script updates yt-dlp to the latest version

sudo rm -f /usr/bin/yt-dlp

## download latest yt-dlp
sudo wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/bin/yt-dlp

## check for errors
if [ $? -ne 0 ]; then
    echo "Error downloading yt-dlp"
    exit 1
fi

## update the permissions
sudo chmod a+rx /usr/bin/yt-dlp

if [ $? -ne 0 ]; then
    echo "Error updating permissions for yt-dlp"
    exit 1
fi

echo "yt-dlp has been updated successfully."