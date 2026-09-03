#!/bin/bash
find /usr/share/fonts -name "*OpenSans*" -o -name "*open-sans*" -o -name "*OpenSans*" 2>/dev/null
echo "---"
fc-list | grep -i "open sans" 2>/dev/null || echo "fc-list not available or no Open Sans"
echo "---"
ls /usr/share/fonts/truetype/ 2>/dev/null
