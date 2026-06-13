#!/bin/bash

currentDir=`pwd`
cd `dirname $0`/..
backboneDir=`pwd`
cd $currentDir

envFileArg=""
if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
  envFileArg="--env-file=$ENV_FILE"
fi

node $envFileArg --import tsx/esm "$backboneDir/src/main.ts" $@
# deno run -A $envFileArg --sloppy-imports "$backboneDir/src/main.ts" $@
