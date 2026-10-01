# Read-only shader-resource inspection using Microsoft's installed disassembler.
# Pass a compiled shader resource, never the game executable. Output is private.
param([Parameter(Mandatory=$true)][string]$Shader)
$ErrorActionPreference = 'Stop'
if ([IO.Path]::GetExtension($Shader) -ne '.so') { throw 'Expected an owned .so shader resource' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShaderInspection {
  [ComImport, Guid("8BA5FB08-5195-40E2-AC58-0D989C3A0102"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface Blob {
    [PreserveSig] IntPtr GetBufferPointer();
    [PreserveSig] UIntPtr GetBufferSize();
  }
  [DllImport("d3dcompiler_47.dll", CallingConvention=CallingConvention.StdCall)]
  static extern int D3DDisassemble(byte[] code, UIntPtr length, uint flags,
    [MarshalAs(UnmanagedType.LPStr)] string comments, out Blob output);
  public static string Read(byte[] bytes) {
    Blob output;
    Marshal.ThrowExceptionForHR(D3DDisassemble(bytes, (UIntPtr)bytes.Length, 0, null, out output));
    try { return Marshal.PtrToStringAnsi(output.GetBufferPointer(), checked((int)output.GetBufferSize().ToUInt64()) - 1); }
    finally { Marshal.ReleaseComObject(output); }
  }
}
'@
[ShaderInspection]::Read([IO.File]::ReadAllBytes($Shader))
