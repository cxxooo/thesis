// Sets the icon + name/version shown in Windows (Explorer, Properties, Task Manager) on the .exe.
// Usage: node windows-exe.js "<path to exe>" "<path to .ico>" <version> "<product name>"
// Needs: npm i resedit@2 pe-library@1  (build-windows.sh installs these into .build-tools)
const fs = require('fs');
const ResEdit = require('resedit');
const PE = require('pe-library');

const [exePath, icoPath, version, name] = process.argv.slice(2);
const exe = PE.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = PE.NtExecutableResource.from(exe);

// icon: replace the exe's existing icon group with ours
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const g = groups[0];
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g ? g.id : 1, g ? g.lang : 1033, iconFile.icons.map((i) => i.data));

// version info / names
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
const [a, b, c] = version.split('.').map(Number);
vi.setFileVersion(a, b, c, 0, 1033);
vi.setProductVersion(a, b, c, 0, 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, {
  FileDescription: name, ProductName: name, InternalName: name,
  OriginalFilename: `${name}.exe`, CompanyName: 'ArtCenter thesis prototype', LegalCopyright: '',
});
vi.outputToResourceEntries(res.entries);

res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('     exe icon + name set');
