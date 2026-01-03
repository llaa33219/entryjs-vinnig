#!/bin/bash

# Entry Turbo 빌드 스크립트
# 사용법: ./build.sh
#
# 출력: dist/entry-turbo.min.js (단일 파일)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_FILE="$SCRIPT_DIR/src/entry-turbo.js"
DIST_DIR="$SCRIPT_DIR/dist"

echo "⚡ Entry Turbo 빌드"
echo ""

mkdir -p "$DIST_DIR"

# 개발용 복사
cp "$SRC_FILE" "$DIST_DIR/entry-turbo.js"

# 압축 버전 생성
if command -v npx &> /dev/null && npx terser --version &> /dev/null; then
    npx terser "$SRC_FILE" --compress --mangle -o "$DIST_DIR/entry-turbo.min.js"
    echo "✅ 압축 완료 (terser)"
else
    cp "$SRC_FILE" "$DIST_DIR/entry-turbo.min.js"
    echo "⚠️  terser 없음 - 압축 없이 복사"
fi

echo ""
echo "📦 배포 파일:"
ls -lh "$DIST_DIR/entry-turbo.min.js"
echo ""
echo "사용: <script src=\"entry-turbo.min.js\"></script>"
