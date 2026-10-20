using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using Microsoft.Win32;

class Launcher {
  static void CopyFrames(Stream input, Stream output) {
    byte[] header=new byte[4];
    while(true) {
      int first=input.ReadByte();if(first<0)return;header[0]=(byte)first;
      ReadExactly(input,header,1,3);
      int length=BitConverter.ToInt32(header,0);
      if(length<2 || length>8000000)throw new IOException("Invalid native message length");
      byte[] body=new byte[length];ReadExactly(input,body,0,length);
      output.Write(header,0,4);output.Write(body,0,body.Length);output.Flush();
    }
  }
  static void ReadExactly(Stream stream,byte[] buffer,int offset,int count) {
    while(count>0){int n=stream.Read(buffer,offset,count);if(n<=0)throw new EndOfStreamException();offset+=n;count-=n;}
  }
  [STAThread] static int Main(string[] args) {
    string root=AppDomain.CurrentDomain.BaseDirectory;
    if(args.Length>0 && (args[0]=="--install" || args[0]=="--register-silent" || args[0]=="--uninstall")) {
      bool uninstall=args[0]=="--uninstall";
      string hostName="com.huaban.original_downloader";
      string[] keys={@"Software\Google\Chrome\NativeMessagingHosts\"+hostName,@"Software\Microsoft\Edge\NativeMessagingHosts\"+hostName};
      try {
        if(uninstall) { foreach(string key in keys)Registry.CurrentUser.DeleteSubKeyTree(key,false); }
        else {
          var serializer=new JavaScriptSerializer();
          var identity=serializer.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"app","identity.json"),Encoding.UTF8));
          var manifest=new Dictionary<string,object>{{"name",hostName},{"description","Huaban Original Downloader"},{"path",Path.Combine(root,"HuabanDownloader.exe")},{"type","stdio"},{"allowed_origins",new string[]{"chrome-extension://"+identity["extensionId"]+"/"}}};
          string manifestPath=Path.Combine(root,"app","native-host.json");
          File.WriteAllText(manifestPath,serializer.Serialize(manifest),new UTF8Encoding(false));
          foreach(string key in keys)using(RegistryKey r=Registry.CurrentUser.CreateSubKey(key)){r.SetValue("",manifestPath,RegistryValueKind.String);}
        }
        if(args[0]!="--register-silent")MessageBox.Show(uninstall?"本地连接已移除。已下载的原图和任务记录会保留。":"本地引擎已安装。\n\n下一步：打开 Chrome 扩展程序页面，加载本文件夹中的 extension 文件夹。\n\n移动本文件夹后，需要重新运行安装。","花瓣原图下载器");
        return 0;
      } catch(Exception e) {MessageBox.Show(e.Message,"安装未完成");return 1;}
    }
    if(args.Length>0 && args[0]=="--pick-folder") {
      Console.OutputEncoding=new UTF8Encoding(false);
      Application.EnableVisualStyles();
      using(var dialog=new FolderBrowserDialog()) {
        dialog.Description="选择花瓣原图的保存位置";
        dialog.ShowNewFolderButton=true;
        if(dialog.ShowDialog()==DialogResult.OK) Console.Write(dialog.SelectedPath);
      }
      return 0;
    }
    if(args.Length>0 && args[0].StartsWith("chrome-extension://")) {
      var p=new Process();
      p.StartInfo=new ProcessStartInfo(Path.Combine(root,"runtime","node.exe"),"\""+Path.Combine(root,"app","native-host.cjs")+"\" \""+args[0]+"\"") {
        UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true
      };
      try {
        p.Start();
        Task input=Task.Factory.StartNew(()=>{try{CopyFrames(Console.OpenStandardInput(),p.StandardInput.BaseStream);}finally{try{p.StandardInput.Close();}catch{}}},TaskCreationOptions.LongRunning);
        Task output=Task.Factory.StartNew(()=>CopyFrames(p.StandardOutput.BaseStream,Console.OpenStandardOutput()),TaskCreationOptions.LongRunning);
        Task errors=p.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
        p.WaitForExit();Task.WaitAll(output,errors);return p.ExitCode;
      } catch(Exception e){Console.Error.Write(e.Message);return 1;}
    }
    Application.EnableVisualStyles();
    MessageBox.Show("首次使用：先双击“安装本地引擎.cmd”，再按“使用说明.html”加载浏览器插件。\n\n日常使用：在花瓣画板点击插件图标。", "花瓣原图下载器",MessageBoxButtons.OK,MessageBoxIcon.Information);
    return 0;
  }
}
