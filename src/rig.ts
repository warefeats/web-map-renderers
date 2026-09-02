export interface RigInfo {
  platform: NodeJS.Platform;
  machine: string;
  chip: string;
  cores: string;
  memory: string;
  os: string;
  arch: string;
  gpu: string;
  display: string;
}

async function run(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.trim();
}

async function windows(): Promise<RigInfo> {
  const script = `
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem
$gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.Status -eq 'OK' -and $_.Name -notmatch 'Basic Render' } | Select-Object -First 1
$mem = Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum
$speed = (Get-CimInstance Win32_PhysicalMemory | Select-Object -First 1).ConfiguredClockSpeed
$ver = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion').DisplayVersion
[pscustomobject]@{
  machine = ($cs.Manufacturer + ' ' + $cs.Model).Trim()
  chip = $cpu.Name.Trim()
  cores = "$($cpu.NumberOfCores) cores / $($cpu.NumberOfLogicalProcessors) threads"
  memory = "$([math]::Round($mem.Sum / 1GB)) GB" + $(if ($speed) { " at $speed MT/s" } else { '' })
  os = "$($os.Caption) $ver (build $($os.BuildNumber))"
  arch = $os.OSArchitecture
  gpu = "$($gpu.Name), driver $($gpu.DriverVersion) ($([datetime]$gpu.DriverDate | Get-Date -Format yyyy-MM-dd))"
  display = "$($gpu.CurrentHorizontalResolution)x$($gpu.CurrentVerticalResolution) at $($gpu.CurrentRefreshRate) Hz attached"
} | ConvertTo-Json -Compress`;
  const json = await run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script]);
  const r = JSON.parse(json) as Omit<RigInfo, "platform">;
  return { platform: "win32", ...r, arch: r.arch.replace("64-bit", "x64") };
}

async function darwin(): Promise<RigInfo> {
  const chip = await run(["sysctl", "-n", "machdep.cpu.brand_string"]);
  const cores = await run(["sysctl", "-n", "hw.ncpu"]);
  const perf = await run(["sysctl", "-n", "hw.perflevel0.logicalcpu"]).catch(() => "");
  const eff = await run(["sysctl", "-n", "hw.perflevel1.logicalcpu"]).catch(() => "");
  const memBytes = Number(await run(["sysctl", "-n", "hw.memsize"]));
  const product = await run(["sw_vers", "-productVersion"]);
  const model = await run(["sysctl", "-n", "hw.model"]);
  const arch = await run(["uname", "-m"]);
  return {
    platform: "darwin",
    machine: model,
    chip,
    cores: perf && eff ? `${cores} CPU cores (${perf} performance, ${eff} efficiency)` : `${cores} CPU cores`,
    memory: `${Math.round(memBytes / 1024 ** 3)} GB`,
    os: `macOS ${product}`,
    arch,
    gpu: `${chip} integrated GPU`,
    display: "offscreen",
  };
}

export async function rigInfo(): Promise<RigInfo> {
  if (process.platform === "win32") return windows();
  if (process.platform === "darwin") return darwin();
  return {
    platform: process.platform,
    machine: "unknown",
    chip: await run(["uname", "-p"]),
    cores: `${navigator.hardwareConcurrency} threads`,
    memory: "unknown",
    os: await run(["uname", "-sr"]),
    arch: await run(["uname", "-m"]),
    gpu: "unknown",
    display: "offscreen",
  };
}
