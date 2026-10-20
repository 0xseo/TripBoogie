import {spawnSync} from 'node:child_process';
for(const [command,args,cwd] of [['npx',['vite','build','--config','native/keyboard-test/vite.config.ts'],'.'],['./gradlew',['--no-daemon','--max-workers=2',':app:connectedDebugAndroidTest','-Pandroid.testInstrumentationRunnerArguments.package=com.tripboogie.app'],'android']]){
 const result=spawnSync(command,args,{cwd,stdio:'inherit',env:process.env});if(result.status!==0)process.exit(result.status||1);
}
