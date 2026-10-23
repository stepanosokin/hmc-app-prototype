"""T16 offline policy, approved platform input difference and wireless cleanup.

The shared full browser/numerical acceptance lives in evidence_t15.check_updates.
These checks use archived inputs, never the current viewer or installed browsers.
"""

import hashlib
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from evidence_t15 import read, relative, require

ATTEMPTS = {'dev1', 'dev2', 'dev3', 'updates-dev1', 'android-final1',
            'android-repeat1', 'desktop-final1', 'desktop-final2'}


# Exact approved replacement inside the desktop !android cleanup branch.
OLD_CLEANUP = """        if(child?.pid){await delay(500);if(child.exitCode===null)execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});}
"""
NEW_CLEANUP = """        if(child?.pid){await delay(500);if(child.exitCode===null){
            // taskkill can return failure when a child exits during tree traversal.
            // The independent profile-specific inventory below decides retirement.
            try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'pipe'});}
            catch(error){report.browser_termination_warning=String(error);}
        }}
"""


def offline_report(report: dict[str, Any], *, phone: bool) -> None:
    require(report['configuration'].get('public_runtime_blocked') is True, 'T16 offline mode missing')
    network = report['network']
    origin = urlsplit(network['origin'])
    require(origin.scheme == 'http' and origin.hostname == '127.0.0.1' and origin.port is not None
            and not origin.username and not origin.password and not origin.path
            and not origin.query and not origin.fragment, 'T16 local origin invalid')
    probes = {'https://hmc-runtime-check.invalid/' + path for path in ('page', 'worker', 'nested-worker')}
    require(network['status'] == 'passed' and {r['url'] for r in network['blocked']} == probes
            and network['probes'] == {'page': True, 'worker': True}, 'T16 blocked probe matrix incomplete')
    require(bool(network['allowed']) and all(urlsplit(r['url']).scheme == origin.scheme
            and urlsplit(r['url']).netloc == origin.netloc for r in network['allowed']), 'T16 public runtime dependency')
    # The dedicated T14 race scenario ran on both desktop browsers; the physical
    # Android gate ran the T13 base and T15 update scenario, not T14 navigation.
    if phone:
        return
    races = report['navigation']['races']
    for stage in ('fetch', 'decode', 'upload'):
        for destination in ('gap', 'run'):
            race: dict[str, Any] = next((r for r in races if r.get('stage') == stage
                                        and r.get('destination') == destination), {})
            events = {e['event'] for e in race.get('history', []) if e['stage'] == stage}
            held = 'real texture write before pause' if stage == 'upload' else 'held'
            require(race.get('obsolete_completion_rejected') is True and {held, 'released'}.issubset(events),
                    'T16 navigation race incomplete')
    require(any(r.get('stage') == 'point' and r.get('different_run_after_release') is True
                and {'held', 'released'}.issubset({e['event'] for e in r.get('history', [])}) for r in races),
            'T16 delayed point race incomplete')


def check_offline_archive(archive: Path) -> None:
    require({p.name for p in (archive / 'attempts').iterdir()} == ATTEMPTS, 'T16 attempt history incomplete')
    for item in read(archive / 'artifact-index.json')['artifacts']:
        payload = (archive / relative(item['name'])).read_bytes()
        blob = b'blob ' + str(len(payload)).encode() + b'\0' + payload
        require(hashlib.sha1(blob).hexdigest() == item['git_object'], 'T16 Git blob identity mismatch')
    desktop = archive / 'attempts/desktop-final2/reports'
    android = archive / 'attempts/android-repeat1/reports'
    before, after = read(android / 'inputs-start.json'), read(desktop / 'inputs-start.json')
    runner = 'tools/check-weather-viewer.mjs'
    require(before.keys() == after.keys() and {k for k in before if before[k] != after[k]} == {runner}
            and {'tools/viewer-network.mjs', 'viewer/main.ts'}.issubset(after), 'T16 platform inputs differ')
    delta = read(archive / 'checks/validation-input-difference.json')
    require(delta['files'] == [{'path': runner, 'android': before[runner], 'desktop': after[runner]}],
            'T16 input difference record mismatch')
    old = (android / 'inputs' / runner).read_bytes().decode('utf-8')
    new = (desktop / 'inputs' / runner).read_bytes().decode('utf-8')
    branch = "    }else{\n        await clean('browser_stopped',async()=>{\n"
    require(old.count(branch + OLD_CLEANUP) == new.count(branch + NEW_CLEANUP) == 1
            and new.replace(branch + NEW_CLEANUP, branch + OLD_CLEANUP) == old,
            'T16 runner difference exceeds desktop cleanup')


def check_offline_cleanup(archive: Path) -> None:
    cleanup = read(archive / 'checks/final-cleanup.json')
    projects = cleanup['projects']
    attempts = list((archive / 'attempts').iterdir())
    expected = {read(a / 'retirement.json')['project'] for a in attempts}
    require(len(projects) == len(expected) == len(attempts) == cleanup['retired_projects']
            and {p['project'] for p in projects} == expected
            and all(p[k] == 0 for p in projects for k in ('container', 'network', 'volume'))
            and cleanup['owned_browser_adb_processes_remaining'] == cleanup['owned_listeners_remaining'] == 0
            and cleanup['retained_task_stacks'] == [], 'T16 final cleanup incomplete')
    host = read(archive / 'android-tools/cleanup.json')
    require(all(host.get(k) is True for k in ('runner_mappings_tab_ui_dump_retired',
            'diagnostic_tab_server_mappings_retired', 'owned_keys_removed', 'owned_server_stopped',
            'sdk_removed', 'owned_keys_verified_before_removal', 'user_adb_5037_preserved'))
            and host['owned_listeners_remaining'] == 0, 'T16 wireless ADB cleanup incomplete')
    device = read(archive / 'android-tools/device-cleanup.json')
    require(device['owner_confirmed_pairing_removed'] is True
            and device['owner_confirmed_wireless_debugging_disabled'] is True, 'T16 device cleanup incomplete')
