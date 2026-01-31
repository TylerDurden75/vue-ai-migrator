#!/bin/bash

# NPM publish script with token support
# Usage: ./publish.sh [your-npm-token]

set -e

echo "🚀 Publishing vue-ai-migrator to npm..."

# Check that we're in the correct directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Run this script from the project root."
    exit 1
fi

# Check that the build is up to date
echo "📦 Checking build..."
npm run build

# Check that tests pass
echo "🧪 Running tests..."
npm test

# Check version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "📌 Current version: $CURRENT_VERSION"

# Check version on npm
NPM_VERSION=$(npm view vue-ai-migrator version 2>/dev/null || echo "0.0.0")
echo "📌 Version on npm: $NPM_VERSION"

if [ "$CURRENT_VERSION" = "$NPM_VERSION" ]; then
    echo "⚠️  Warning: Version $CURRENT_VERSION already exists on npm!"
    echo "   Do you want to continue anyway? (y/N)"
    read -r response
    if [ "$response" != "y" ] && [ "$response" != "Y" ]; then
        echo "❌ Publication cancelled."
        exit 1
    fi
fi

# If a token is provided as argument, use it
if [ -n "$1" ]; then
    echo "🔑 Using provided token..."
    export NPM_TOKEN="$1"
    echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" > .npmrc
    echo "✅ Token configured in .npmrc"
fi

# Check if user is logged in
if ! npm whoami > /dev/null 2>&1; then
    echo "❌ Error: You are not logged in to npm."
    if [ -z "$1" ]; then
        echo "   Use: ./publish.sh your-npm-token"
        echo "   Or log in with: npm login"
    fi
    exit 1
fi

USER=$(npm whoami)
echo "👤 Logged in as: $USER"

# Dry-run to check what will be published
echo "🔍 Checking package contents..."
npm pack --dry-run

# Ask for confirmation
echo ""
echo "⚠️  Are you sure you want to publish vue-ai-migrator@$CURRENT_VERSION to npm? (y/N)"
read -r response
if [ "$response" != "y" ] && [ "$response" != "Y" ]; then
    echo "❌ Publication cancelled."
    exit 1
fi

# Publish
echo "📤 Publishing to npm..."
npm publish --access public

echo ""
echo "✅ Publication successful!"
echo "📦 Package: vue-ai-migrator@$CURRENT_VERSION"
echo "🔗 https://www.npmjs.com/package/vue-ai-migrator"

# Clean up .npmrc if created by the script
if [ -n "$1" ] && [ -f ".npmrc" ]; then
    rm .npmrc
    echo "🧹 Temporary .npmrc file removed"
fi
