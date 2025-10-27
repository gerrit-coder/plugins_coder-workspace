package com.gerritforge.gerrit.plugins.coderworkspace;

import com.google.gson.annotations.SerializedName;
import java.util.ArrayList;
import java.util.List;

/** POJO returned to the web UI with plugin configuration from gerrit.config. */
public class ConfigInfo {
  @SerializedName("serverUrl")
  public String serverUrl;
  @SerializedName("apiKey")
  public String apiKey;
  @SerializedName("organization")
  public String organization;
  @SerializedName("user")
  public String user = "me";

  @SerializedName("templateId")
  public String templateId;
  @SerializedName("templateVersionId")
  public String templateVersionId;
  @SerializedName("templateVersionPresetId")
  public String templateVersionPresetId;

  @SerializedName("workspaceNameTemplate")
  public String workspaceNameTemplate = "{repo}-{change}-{patchset}";
  @SerializedName("automaticUpdates")
  public String automaticUpdates = "always";
  @SerializedName("autostart")
  public boolean autostart = true;
  @SerializedName("openAfterCreate")
  public boolean openAfterCreate = true;
  @SerializedName("enableDryRunPreview")
  public boolean enableDryRunPreview = false;
  @SerializedName("ttlMs")
  public long ttlMs = 0;

  @SerializedName("richParams")
  public List<RichParam> richParams = defaultRichParams();
  @SerializedName("templateMappings")
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
