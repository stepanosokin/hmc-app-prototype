import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';

export function workloadBrowserInventory(profile,timeout){
    const output=execFileSync('powershell',['-NoProfile','-Command',
        "$ErrorActionPreference='Stop';$rows=@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:T19_BROWSER_PROFILE) });ConvertTo-Json -Compress -InputObject @($rows | Select-Object ProcessId,ParentProcessId,Name)"],
        {encoding:'utf8',env:{...process.env,T19_BROWSER_PROFILE:profile},windowsHide:true,timeout,maxBuffer:1024**2});
    return JSON.parse(output.trim());
}

/** Confirms completion after taskkill; never terminates additional processes. */
export async function waitForWorkloadBrowserExit(profile,observations,inventory=workloadBrowserInventory,timeoutMs=10000){
    const deadline=performance.now()+timeoutMs;
    while(performance.now()<deadline){
        let processes;
        try{processes=await inventory(profile,Math.max(1,Math.min(3000,Math.floor(deadline-performance.now()))));}
        catch(error){observations.push({observed_at:new Date().toISOString(),inventory_error:String(error)});throw error;}
        assert.ok(Array.isArray(processes),'Profile inventory must return a process array');
        observations.push({observed_at:new Date().toISOString(),count:processes.length,processes});
        assert.ok(performance.now()<=deadline,'Workload browser cleanup deadline exceeded');
        if(processes.length===0)return;
        await pause(Math.max(1,Math.min(100,deadline-performance.now())));
    }
    throw Error('Workload browser cleanup deadline exceeded with owned processes remaining');
}
