import { spawnSync } from 'node:child_process';

const psQuote = value => `'${String(value).replaceAll("'", "''")}'`;
const runPowerShell = (script, timeout = 7000) => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    env: { ...process.env, TEMP: 'D:\\Scratch', TMP: 'D:\\Scratch' }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`PowerShell process identity operation failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout.trim();
};

const parseRows = output => {
  if (!output) return [];
  const value = JSON.parse(output);
  return (Array.isArray(value) ? value : [value]).filter(Boolean).map(row => ({
    pid: Number(row.pid),
    parentPid: Number(row.parentPid),
    created: String(row.created),
    name: String(row.name || '')
  }));
};

export function processTreeRows(rows, expectedRoot) {
  const normalized = rows.map(row => ({ ...row, pid: Number(row.pid), parentPid: Number(row.parentPid), created: String(row.created) }));
  const root = normalized.find(row => row.pid === Number(expectedRoot.pid) && row.created === String(expectedRoot.created));
  if (!root) return [];
  const included = new Map([[`${root.pid}:${root.created}`, root]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const child of normalized) {
      if (included.has(`${child.pid}:${child.created}`)) continue;
      const parent = [...included.values()].find(row => row.pid === child.parentPid);
      if (parent && Date.parse(child.created) >= Date.parse(parent.created)) {
        included.set(`${child.pid}:${child.created}`, child);
        changed = true;
      }
    }
  }
  return [...included.values()];
}

const treeScript = (rootPid, expectedCreated = '') => `$ErrorActionPreference='Stop';$all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,Name;$root=$all|Where-Object{[int]$_.ProcessId -eq ${Number(rootPid)}}|Select-Object -First 1;if(!$root){return};$expected=${psQuote(expectedCreated)};if($expected -and $root.CreationDate.ToUniversalTime().ToString('o') -cne $expected){return};$ids=@([int]$root.ProcessId);$dates=@{};$dates[[int]$root.ProcessId]=$root.CreationDate;do{$before=$ids.Count;foreach($p in $all){$parent=[int]$p.ParentProcessId;if($ids -contains $parent -and $ids -notcontains [int]$p.ProcessId -and $p.CreationDate -ge $dates[$parent]){$ids+= [int]$p.ProcessId;$dates[[int]$p.ProcessId]=$p.CreationDate}}}while($ids.Count -gt $before);$all|Where-Object{$ids -contains [int]$_.ProcessId}|ForEach-Object{[PSCustomObject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;created=$_.CreationDate.ToUniversalTime().ToString('o');name=$_.Name}}|ConvertTo-Json -Compress`;

export function snapshotProcessTree(pid, expectedRoot) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) throw new Error('Process tree root must be a positive PID.');
  if (expectedRoot && (Number(expectedRoot.pid) !== Number(pid) || !expectedRoot.created)) throw new Error('Expected process tree root must pin the requested PID and creation time.');
  return parseRows(runPowerShell(treeScript(pid, expectedRoot?.created || '')));
}

export function identityForPid(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) throw new Error('Process identity PID must be a positive integer.');
  const output = runPowerShell(`$ErrorActionPreference='Stop';$p=Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}";if($p){[PSCustomObject]@{pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;created=$p.CreationDate.ToUniversalTime().ToString('o');name=$p.Name}|ConvertTo-Json -Compress}`);
  return parseRows(output)[0] || null;
}

export function processTreesForCommandLine(fragment) {
  if (!fragment) throw new Error('A unique command-line fragment is required.');
  const needle = psQuote(fragment);
  const rootsOutput = runPowerShell(`$ErrorActionPreference='Stop';$needle=${needle};$self=$PID;Get-CimInstance Win32_Process | Where-Object{$_.ProcessId -ne $self -and $_.CommandLine -and $_.CommandLine.Contains($needle)} | Select-Object -First 100 ProcessId,CreationDate | ForEach-Object{[PSCustomObject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;created=$_.CreationDate.ToUniversalTime().ToString('o');name=$_.Name}} | ConvertTo-Json -Compress`);
  const rootsValue = rootsOutput ? JSON.parse(rootsOutput) : [];
  const roots = (Array.isArray(rootsValue) ? rootsValue : [rootsValue]).filter(row => Number.isInteger(Number(row.pid)) && Number(row.pid) > 0);
  const identities = new Map();
  for (const root of roots) for (const row of snapshotProcessTree(root.pid, root)) identities.set(`${row.pid}:${row.created}`, row);
  return [...identities.values()];
}

function encodedRecords(records) {
  return Buffer.from(JSON.stringify(records.map(({ pid, created }) => ({ pid: Number(pid), created: String(created) })))).toString('base64');
}

export function setBelowNormalExact(records) {
  if (!records.length) return;
  const encoded = encodedRecords(records);
  runPowerShell(`$ErrorActionPreference='Stop';$rows=([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))|ConvertFrom-Json);foreach($row in $rows){$p=Get-CimInstance Win32_Process -Filter "ProcessId=$($row.pid)" -ErrorAction SilentlyContinue;if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -ceq [string]$row.created){(Get-Process -Id ([int]$row.pid) -ErrorAction Stop).PriorityClass='BelowNormal'}}`);
}

export function cleanupExactIdentities(records, timeoutSeconds = 6) {
  if (!records.length) return [];
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 15) throw new Error('Cleanup wait must be between 1 and 15 seconds.');
  const encoded = encodedRecords(records);
  const output = runPowerShell(`$ErrorActionPreference='Stop';$rows=([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))|ConvertFrom-Json);foreach($row in $rows){$p=Get-CimInstance Win32_Process -Filter "ProcessId=$($row.pid)" -ErrorAction SilentlyContinue;if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -ceq [string]$row.created){Stop-Process -Id ([int]$row.pid) -Force -ErrorAction SilentlyContinue}};$until=(Get-Date).AddSeconds(${timeoutSeconds});$still=@();do{$still=@();foreach($row in $rows){$p=Get-CimInstance Win32_Process -Filter "ProcessId=$($row.pid)" -ErrorAction SilentlyContinue;if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -ceq [string]$row.created){$still+= [PSCustomObject]@{pid=[int]$row.pid;created=$p.CreationDate.ToUniversalTime().ToString('o');name=$p.Name}}};if($still.Count){Start-Sleep -Milliseconds 100}}while($still.Count -and (Get-Date) -lt $until);$still|ConvertTo-Json -Compress`);
  return parseRows(output);
}
