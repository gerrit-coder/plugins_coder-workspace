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

  @SerializedName("templateId")
  public String templateId;
  @SerializedName("templateVersionId")
  public String templateVersionId;
  @SerializedName("templateVersionPresetId")
  public String templateVersionPresetId;

  @SerializedName("workspaceNameTemplate")
  public String workspaceNameTemplate = "{repo}-{change}-{patchset}";
  @SerializedName("alternateNameTemplates")
  public List<String> alternateNameTemplates = new ArrayList<>();
  @SerializedName("openAfterCreate")
  public boolean openAfterCreate = true;
  @SerializedName("enableDryRunPreview")
  public boolean enableDryRunPreview = false;
  @SerializedName("ttlMs")
  public long ttlMs = 0;

  @SerializedName("appSlug")
  public String appSlug;

  @SerializedName("waitForAppReadyMs")
  public long waitForAppReadyMs = 0;

  @SerializedName("waitPollIntervalMs")
  public long waitPollIntervalMs = 1000;

  @SerializedName("richParams")
  public List<RichParam> richParams = defaultRichParams();
  @SerializedName("templateMappings")
  public List<TemplateMapping> templateMappings = new ArrayList<>();

  // Auth/cross-origin helpers
  @SerializedName("retryAuthWithQueryParam")
  public boolean retryAuthWithQueryParam = true;

  @SerializedName("apiKeyQueryParamName")
  public String apiKeyQueryParamName = "coder_session_token";

  @SerializedName("appendTokenToAppUrl")
  public boolean appendTokenToAppUrl = false;

  @SerializedName("navigateInSameTabOnBlock")
  public boolean navigateInSameTabOnBlock = true;

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
    list.add(new RichParam("GERRIT_GIT_SSH_URL", "gitSshUrl"));
    list.add(new RichParam("GERRIT_CHANGE_REF", "changeRef"));
    return list;
  }
}
