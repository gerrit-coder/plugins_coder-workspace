package com.gerritforge.gerrit.plugins.coderworkspace;

import java.util.ArrayList;
import java.util.List;

/** POJO returned to the web UI with plugin configuration from gerrit.config. */
public class ConfigInfo {
  public String serverUrl;
  public String apiKey;
  public String organization;
  public String user = "me";

  public String templateId;
  public String templateVersionId;
  public String templateVersionPresetId;

  public String workspaceNameTemplate = "{repo}-{change}-{patchset}";
  public String automaticUpdates = "always";
  public boolean autostart = true;
  public boolean openAfterCreate = true;
  public boolean enableDryRunPreview = false;
  public long ttlMs = 0;
  public int historyLimit = 10;

  public List<RichParam> richParams = defaultRichParams();
  public List<TemplateMapping> templateMappings = new ArrayList<>();

  public static class RichParam {
    public String name;
    public String from;

    public RichParam() {}

    public RichParam(String name, String from) {
      this.name = name;
      this.from = from;
    }
  }

  public static class TemplateMapping {
    public String repo;
    public String branch;
    public String templateId;
    public String templateVersionId;
    public String templateVersionPresetId;
    public String workspaceNameTemplate;
    public List<RichParam> richParams;
  }

  private static List<RichParam> defaultRichParams() {
    ArrayList<RichParam> list = new ArrayList<>();
    list.add(new RichParam("REPO", "repo"));
    list.add(new RichParam("BRANCH", "branch"));
    list.add(new RichParam("GERRIT_CHANGE", "change"));
    list.add(new RichParam("GERRIT_PATCHSET", "patchset"));
    list.add(new RichParam("GERRIT_CHANGE_URL", "url"));
    return list;
  }
}
