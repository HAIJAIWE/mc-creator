// Windows Job Object native binding -- design doc SS8.3 process-level isolation.
//
// NOTE ON ENCODING: this file is deliberately ASCII-only. MSVC reads source in
// the *system* code page (936/GBK on a Chinese Windows, 437 on CI's
// windows-latest). A GBK trail byte can be 0x5C ('\'), so a UTF-8 Chinese
// comment gets misread as a line-continuation and swallows the following
// #endif -- surfacing as a baffling "error C1020: unexpected #endif".
// The /utf-8 compiler flag fixes it, but gyp does not reliably propagate
// cflags_cc to MSVC (it silently dropped both /utf-8 and defines here).
// ASCII-only source is immune on every locale. The Chinese design rationale
// lives in ../README.md.
//
// ---------------------------------------------------------------------------
// Why a native module at all
// ---------------------------------------------------------------------------
// SS8.3 constraint: SecurityManager is deprecated as of JDK 17 and permanently
// disabled in JDK 24, so "sandbox Java code in-process" is officially closed off
// and isolation must come from the process/container level. Node's
// child_process exposes no resource ceilings, so memory/CPU caps and a
// guaranteed whole-tree kill have to go through Win32 APIs.
//
// Why N-API rather than raw V8
// ----------------------------
// The repo's isolated-vm never loaded once on Electron 44 (MEMORY SS2-3): it used
// raw V8 ABI, prebuilds stopped at abi147, Electron 44 is abi149. This module
// uses node-addon-api (N-API), whose ABI is stable across Node/Electron, so the
// prebuild filename carries no abi tag -- the same mechanism node-pty already
// uses successfully in this repo (see apps/desktop/electron-builder.yml).
//
// Why this module must own CreateProcess
// --------------------------------------
// The obvious approach is: spawn from JS, then OpenProcess by pid and call
// AssignProcessToJobObject. That has a TOCTOU window: the child can execute
// instructions before it is in the job, so a malicious build script can spawn a
// grandchild *outside* the job within the first few milliseconds -- escaping
// both the memory/CPU ceilings and the tree kill.
//
// Once a process is in a job, its descendants are inherited into that same job
// by the kernel. So the only way to close the window is to assign before the
// first instruction runs:
//   CreateProcess(CREATE_SUSPENDED) -> AssignProcessToJobObject -> ResumeThread
// which is exactly what SpawnInJob does.
//
// stdio
// -----
// This module does NOT capture the child's pipes: CreateProcess is called with
// bInheritHandles=FALSE and no stdio redirection, so the child writes straight to
// whatever stdout/stderr this process inherited. Callers that need logs (e.g.
// Gradle) must go through launcher.js, which inherits its own stdio downward so
// the existing JS spawn pipeline keeps working.
//
// Verified by real runs (see MEMORY, SS8.3 round): a child allocating memory
// under a 96MB cap died with ERR_MEMORY_ALLOCATION_FAILED in ~58ms, and one
// terminateTree call killed both a parent and its grandchild -- proving
// descendants really are inherited into the job.

// _WIN32_WINNT must precede every header: napi.h transitively includes Windows
// headers, and JOB_OBJECT_CPU_RATE_CONTROL_* are only declared when the SDK is
// told we target Win8+.
#ifdef _WIN32
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#ifndef WINVER
#define WINVER 0x0A00
#endif
#endif

#include <napi.h>

#ifdef _WIN32
#include <windows.h>
#endif

#ifdef _WIN32

namespace {

// Napi::External needs a real class type; HANDLE is a void* typedef, so wrap it.
struct JobBox {
  HANDLE h = nullptr;
};

struct ChildBox {
  HANDLE process = nullptr;
  HANDLE job = nullptr;
  DWORD pid = 0;
};

std::wstring Widen(const Napi::String& s) {
  return std::wstring(reinterpret_cast<const wchar_t*>(s.Utf16Value().c_str()),
                      s.Utf16Value().length());
}

// Quote one argv element per the CommandLineToArgvW rules, so a path containing
// spaces cannot smuggle extra arguments into the command line.
std::wstring Quote(const std::wstring& in) {
  if (in.find_first_of(L" \t\"") == std::wstring::npos) return in;
  std::wstring out = L"\"";
  for (size_t i = 0; i < in.size(); i++) {
    size_t backslashes = 0;
    while (i < in.size() && in[i] == L'\\') {
      i++;
      backslashes++;
    }
    if (i == in.size()) {
      out.append(backslashes * 2, L'\\');
      break;
    }
    if (in[i] == L'"') {
      out.append(backslashes * 2 + 1, L'\\');
      out.push_back(L'"');
    } else {
      out.append(backslashes, L'\\');
      out.push_back(in[i]);
    }
  }
  out.push_back(L'"');
  return out;
}

void ThrowWin32(Napi::Env env, const char* what) {
  Napi::Error::New(env, std::string("[jobobject] ") + what + " failed, GetLastError=" +
                           std::to_string(GetLastError()))
      .ThrowAsJavaScriptException();
}

// Create a job with hard ceilings.
//   maxMemoryMb: per-process memory cap in MB (<=0 = no cap). Mapped to
//     JOB_OBJECT_LIMIT_PROCESS_MEMORY, which is a real enforced ceiling --
//     an over-limit allocation fails rather than being merely discouraged.
//   maxCpuCores: CPU quota in cores (<=0 = no cap), mapped to
//     JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP as a percentage of the machine.
Napi::Value CreateJob(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const int64_t maxMemoryMb =
      info.Length() > 0 && info[0].IsNumber() ? info[0].As<Napi::Number>().Int64Value() : 0;
  const int64_t maxCpuCores =
      info.Length() > 1 && info[1].IsNumber() ? info[1].As<Napi::Number>().Int64Value() : 0;

  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  if (job == nullptr) {
    ThrowWin32(env, "CreateJobObjectW");
    return env.Undefined();
  }

  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  // Closing the handle kills the tree. This is a strictly better termination
  // path than `taskkill /t /f`: it needs no external tool, and it cannot act on
  // a recycled pid.
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (maxMemoryMb > 0) {
    limits.ProcessMemoryLimit = static_cast<SIZE_T>(maxMemoryMb) * 1024ull * 1024ull;
    limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY;
  }
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits,
                               sizeof(limits))) {
    const DWORD err = GetLastError();
    CloseHandle(job);
    Napi::Error::New(env, "[jobobject] SetInformationJobObject(limits) failed, GetLastError=" +
                             std::to_string(err))
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (maxCpuCores > 0) {
    SYSTEM_INFO si{};
    GetSystemInfo(&si);
    DWORD pct = static_cast<DWORD>((maxCpuCores * 10000) / si.dwNumberOfProcessors);
    if (pct > 10000) pct = 10000;
    JOBOBJECT_CPU_RATE_CONTROL_INFORMATION cpu{};
    cpu.ControlFlags =
        JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP;
    cpu.CpuRate = pct;
    if (!SetInformationJobObject(job, JobObjectCpuRateControlInformation, &cpu,
                                 sizeof(cpu))) {
      const DWORD err = GetLastError();
      CloseHandle(job);
      Napi::Error::New(env, "[jobobject] SetInformationJobObject(cpu) failed, GetLastError=" +
                               std::to_string(err))
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
  }

  return Napi::External<JobBox>::New(env, new JobBox{job});
}

// Create a child inside the job and return IMMEDIATELY.
//
// Deliberately does not wait: a Gradle build can run for ten minutes and the
// caller needs streaming logs plus its own timeout, so the waiting policy has to
// stay in JS (see WaitForExit).
//
// Returns { child, pid }.
Napi::Value SpawnInJob(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  JobBox* box = info[0].As<Napi::External<JobBox>>().Data();
  HANDLE job = box->h;
  const std::wstring file = Widen(info[1].As<Napi::String>());

  std::wstring cmdline = Quote(file);
  Napi::Array argv = info[2].As<Napi::Array>();
  for (uint32_t i = 0; i < argv.Length(); i++) {
    cmdline.push_back(L' ');
    cmdline += Quote(Widen(argv.Get(i).As<Napi::String>()));
  }

  std::wstring cwd;
  if (info.Length() > 3 && info[3].IsString()) cwd = Widen(info[3].As<Napi::String>());

  // stdio inheritance, opt-in via a 5th argument (see below).
  const bool inheritStdio = info.Length() > 4 && info[4].ToBoolean().Value();

  STARTUPINFOW si{};
  si.cb = sizeof(si);
  PROCESS_INFORMATION pi{};

  // Passing bInheritHandles=FALSE and no STARTF_USESTDHANDLES does NOT mean
  // "inherit the parent's stdio": the child gets a brand-new console and its
  // output never reaches our pipes, so log collection silently yields nothing.
  // To hand the child exactly our stdout/stderr we must both name the handles
  // and allow inheritance. Node creates those pipe handles inheritable for its
  // direct children, so passing them through works.
  BOOL inheritHandles = FALSE;
  HANDLE dupIn = nullptr;
  HANDLE dupOut = nullptr;
  HANDLE dupErr = nullptr;
  if (inheritStdio) {
    // The std handles must be explicitly marked inheritable. Passing
    // bInheritHandles=TRUE only propagates handles that already carry
    // HANDLE_FLAG_INHERIT; a pipe Node created for *its* child may not, in
    // which case the child gets fresh handles and its output goes to a
    // console nobody reads -- observed as empty stdout with exit code 0.
    // Duplicating with bInheritHandle=TRUE guarantees the flag.
    const DWORD kSource = DUPLICATE_SAME_ACCESS;
    const BOOL okIn =
        DuplicateHandle(GetCurrentProcess(), GetStdHandle(STD_INPUT_HANDLE),
                        GetCurrentProcess(), &dupIn, 0, TRUE, DUPLICATE_SAME_ACCESS);
    const BOOL okOut =
        DuplicateHandle(GetCurrentProcess(), GetStdHandle(STD_OUTPUT_HANDLE),
                        GetCurrentProcess(), &dupOut, 0, TRUE, kSource);
    const BOOL okErr =
        DuplicateHandle(GetCurrentProcess(), GetStdHandle(STD_ERROR_HANDLE),
                        GetCurrentProcess(), &dupErr, 0, TRUE, kSource);
    (void)okIn;
    if (okOut && okErr) {
      si.dwFlags |= STARTF_USESTDHANDLES;
      si.hStdInput = okIn ? dupIn : GetStdHandle(STD_INPUT_HANDLE);
      si.hStdOutput = dupOut;
      si.hStdError = dupErr;
      inheritHandles = TRUE;
    } else {
      if (dupOut) CloseHandle(dupOut);
      if (dupErr) CloseHandle(dupErr);
      if (dupIn) CloseHandle(dupIn);
      dupOut = nullptr;
      dupErr = nullptr;
      dupIn = nullptr;
    }
  }

  std::vector<wchar_t> mutable_cmd(cmdline.begin(), cmdline.end());
  mutable_cmd.push_back(L'\0');

  // CREATE_SUSPENDED is the entire reason this module exists; see header.
  const BOOL ok = CreateProcessW(nullptr, mutable_cmd.data(), nullptr, nullptr, inheritHandles,
                                 CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, nullptr,
                                 cwd.empty() ? nullptr : cwd.c_str(), &si, &pi);
  if (!ok) {
    ThrowWin32(env, "CreateProcessW");
    return env.Undefined();
  }

  const BOOL assigned = AssignProcessToJobObject(job, pi.hProcess);
  ResumeThread(pi.hThread);
  CloseHandle(pi.hThread);

  if (!assigned) {
    // Letting the process run after a failed assignment means silently losing
    // isolation, which is far worse than failing: kill it immediately.
    const DWORD err = GetLastError();
    TerminateProcess(pi.hProcess, 1);
    CloseHandle(pi.hProcess);
    Napi::Error::New(env, "[jobobject] AssignProcessToJobObject failed, GetLastError=" +
                             std::to_string(err))
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // The parent no longer needs its duplicates once the child holds them.
  if (dupIn) CloseHandle(dupIn);
  if (dupOut) CloseHandle(dupOut);
  if (dupErr) CloseHandle(dupErr);

  Napi::Object out = Napi::Object::New(env);
  out.Set("child",
          Napi::External<ChildBox>::New(env, new ChildBox{pi.hProcess, job, pi.dwProcessId}));
  out.Set("pid", Napi::Number::New(env, static_cast<double>(pi.dwProcessId)));
  return out;
}

// Wait for exit with a ceiling, WITHOUT killing.
//
//   timeoutMs == 0  -> poll: return immediately
//   timeoutMs <  0  -> wait forever
//   timeoutMs >  0  -> wait that many ms
//
// 0-means-poll is deliberate. An earlier version treated <=0 as INFINITE, so a
// caller expecting a non-blocking poll blocked forever instead -- that footgun
// cost real debugging time here. "Check without waiting" is the common case
// and must not be the dangerous one.
//
// Returns { exited, exitCode (-1 when not exited), timedOut, pid }.
Napi::Value WaitForExit(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ChildBox* child = info[0].As<Napi::External<ChildBox>>().Data();
  const int64_t timeoutMs =
      info.Length() > 1 && info[1].IsNumber() ? info[1].As<Napi::Number>().Int64Value() : 0;

  const DWORD ms = timeoutMs < 0 ? INFINITE : static_cast<DWORD>(timeoutMs);
  const DWORD r = WaitForSingleObject(child->process, ms);

  const bool exited = r == WAIT_OBJECT_0;
  DWORD code = 0;
  if (exited) GetExitCodeProcess(child->process, &code);

  Napi::Object out = Napi::Object::New(env);
  out.Set("exited", Napi::Boolean::New(env, exited));
  out.Set("exitCode", Napi::Number::New(env, exited ? static_cast<double>(code) : -1));
  out.Set("timedOut", Napi::Boolean::New(env, r == WAIT_TIMEOUT));
  out.Set("pid", Napi::Number::New(env, static_cast<double>(child->pid)));
  return out;
}

// How many processes does the kernel think are in this job right now?
// Lets tests tell "job is empty" apart from "the terminate call failed".
int ActiveProcessCount(HANDLE job) {
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info{};
  DWORD ret = 0;
  if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &info,
                                 sizeof(info), &ret)) {
    return -1;
  }
  return static_cast<int>(info.ActiveProcesses);
}

// One call terminates the parent and every descendant (TerminateJobObject).
// Returns a diagnostic object rather than a bare boolean: an earlier bare-bool
// version returned true while the process demonstrably kept running, which is
// the worst possible failure shape for a kill primitive -- it looks like it
// worked. Now the caller can see ok / lastError / activeProcesses.
Napi::Value TerminateTree(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ChildBox* child = info[0].As<Napi::External<ChildBox>>().Data();
  const int before = ActiveProcessCount(child->job);
  SetLastError(0);
  const BOOL ok = TerminateJobObject(child->job, 1);
  const DWORD err = ok ? 0 : GetLastError();

  Napi::Object out = Napi::Object::New(env);
  out.Set("ok", Napi::Boolean::New(env, ok != FALSE));
  out.Set("lastError", Napi::Number::New(env, static_cast<double>(err)));
  out.Set("activeBefore", Napi::Number::New(env, before));
  out.Set("activeProcesses", Napi::Number::New(env, ActiveProcessCount(child->job)));
  return out;
}

// Self-check: is the child actually inside the job? Guards against "we believed
// we were isolated but were not".
Napi::Value IsInJob(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ChildBox* child = info[0].As<Napi::External<ChildBox>>().Data();
  BOOL inJob = FALSE;
  const BOOL ok = IsProcessInJob(child->process, nullptr, &inJob);
  return Napi::Boolean::New(env, ok != FALSE && inJob != FALSE);
}

Napi::Value CloseChild(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ChildBox* child = info[0].As<Napi::External<ChildBox>>().Data();
  if (child->process != nullptr) {
    CloseHandle(child->process);
    child->process = nullptr;
  }
  delete child;
  return env.Undefined();
}

Napi::Value CloseJob(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  JobBox* box = info[0].As<Napi::External<JobBox>>().Data();
  const BOOL ok = CloseHandle(box->h);
  delete box;
  return Napi::Boolean::New(env, ok != FALSE);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("createJob", Napi::Function::New(env, CreateJob));
  exports.Set("spawnInJob", Napi::Function::New(env, SpawnInJob));
  exports.Set("waitForExit", Napi::Function::New(env, WaitForExit));
  exports.Set("terminateTree", Napi::Function::New(env, TerminateTree));
  exports.Set("isInJob", Napi::Function::New(env, IsInJob));
  exports.Set("closeChild", Napi::Function::New(env, CloseChild));
  exports.Set("closeJob", Napi::Function::New(env, CloseJob));
  return exports;
}

}  // namespace

#else  // !_WIN32

namespace {

Napi::Value Unsupported(const Napi::CallbackInfo& info) {
  Napi::Error::New(info.Env(),
                   "[jobobject] Job Object is Windows-only; not implemented on this platform")
      .ThrowAsJavaScriptException();
  return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  for (const char* name :
       {"createJob", "spawnInJob", "waitForExit", "terminateTree", "isInJob", "closeChild",
        "closeJob"}) {
    exports.Set(name, Napi::Function::New(env, Unsupported));
  }
  return exports;
}

}  // namespace

#endif

NODE_API_MODULE(jobobject, Init)
