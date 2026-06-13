#!/bin/bash

currentDir=`pwd`
cd `dirname $0`/..
backboneDir=`pwd`
cd $currentDir

envFileArg=""
if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
  envFileArg="--env-file=$ENV_FILE"
fi

node $envFileArg --watch --import tsx/esm "$backboneDir/src/main.ts" $@
