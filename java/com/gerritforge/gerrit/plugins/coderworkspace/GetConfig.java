package com.gerritforge.gerrit.plugins.coderworkspace;

import com.google.gerrit.extensions.annotations.PluginName;
import com.google.gerrit.extensions.restapi.Response;
import com.google.gerrit.extensions.restapi.RestReadView;
import com.google.gerrit.server.config.ConfigResource;
import com.google.gerrit.server.config.PluginConfig;
import com.google.gerrit.server.config.PluginConfigFactory;
import com.google.gson.Gson;
import com.google.inject.Inject;

/** Returns plugin configuration loaded from gerrit.config. */
public class GetConfig implements RestReadView<ConfigResource> {
  private final PluginConfigFactory cfgFactory;
  private final String pluginName;
  private final Gson gson = new Gson();

  @Inject
  public GetConfig(PluginConfigFactory cfgFactory, @PluginName String pluginName) {
    this.cfgFactory = cfgFactory;
    this.pluginName = pluginName;
  }

  @Override
  public Response<ConfigInfo> apply(ConfigResource resource) {
    PluginConfig cfg = cfgFactory.getFromGerritConfig(pluginName);
    ConfigInfo info = new ConfigInfo();

    info.serverUrl = cfg.getString("serverUrl");
    info.apiKey = cfg.getString("apiKey");
    info.organization = cfg.getString("organization");

    info.templateId = cfg.getString("templateId");
    info.templateVersionId = cfg.getString("templateVersionId");
    info.templateVersionPresetId = cfg.getString("templateVersionPresetId");

    info.workspaceNameTemplate = cfg.getString("workspaceNameTemplate", info.workspaceNameTemplate);
    info.openAfterCreate = cfg.getBoolean("openAfterCreate", info.openAfterCreate);
    info.enableDryRunPreview = cfg.getBoolean("enableDryRunPreview", info.enableDryRunPreview);
    info.ttlMs = cfg.getLong("ttlMs", info.ttlMs);

    // Optional app slug for deep linking to an app when latest_app_status.uri is not provided
    String appSlug = cfg.getString("appSlug");
    if (appSlug != null && !appSlug.trim().isEmpty()) {
      info.appSlug = appSlug.trim();
    }

    // alternateNameTemplates: allow either JSON array or comma-separated list
    String altsJson = cfg.getString("alternateNameTemplatesJson");
    String altsCsv = cfg.getString("alternateNameTemplates");
    if (altsJson != null && !altsJson.trim().isEmpty()) {
      try {
        String[] arr = gson.fromJson(altsJson, String[].class);
        if (arr != null) {
          info.alternateNameTemplates.clear();
          for (String s : arr) {
            if (s != null && !s.trim().isEmpty()) info.alternateNameTemplates.add(s.trim());
          }
        }
      } catch (Exception e) {
        // ignore malformed JSON; fall back to CSV
      }
    }
    if (info.alternateNameTemplates.isEmpty() && altsCsv != null && !altsCsv.trim().isEmpty()) {
      String[] parts = altsCsv.split(",");
      for (String p : parts) {
        String s = p.trim();
        if (!s.isEmpty()) info.alternateNameTemplates.add(s);
      }
    }

    // Readiness polling options
    info.waitForAppReadyMs = cfg.getLong("waitForAppReadyMs", info.waitForAppReadyMs);
    info.waitPollIntervalMs = cfg.getLong("waitPollIntervalMs", info.waitPollIntervalMs);

    // richParams: comma-separated NAME:from entries
    String rp = cfg.getString("richParams");
    if (rp != null && !rp.trim().isEmpty()) {
      info.richParams.clear();
      String[] parts = rp.split(",");
      for (String p : parts) {
        String s = p.trim();
        if (s.isEmpty()) continue;
        int idx = s.indexOf(":");
        if (idx > 0 && idx < s.length() - 1) {
          String name = s.substring(0, idx).trim();
          String from = s.substring(idx + 1).trim();
          if (!name.isEmpty() && !from.isEmpty()) {
            info.richParams.add(new ConfigInfo.RichParam(name, from));
          }
        }
      }
    }

    // templateMappingsJson: JSON array
    String mappingsJson = cfg.getString("templateMappingsJson");
    if (mappingsJson != null && !mappingsJson.trim().isEmpty()) {
      try {
        ConfigInfo.TemplateMapping[] arr =
            gson.fromJson(mappingsJson, ConfigInfo.TemplateMapping[].class);
        info.templateMappings.clear();
        if (arr != null) {
          for (ConfigInfo.TemplateMapping m : arr) {
            info.templateMappings.add(m);
          }
        }
      } catch (Exception e) {
        // ignore malformed JSON; keep defaults
      }
    }

    // Auth helpers
    info.retryAuthWithQueryParam =
        cfg.getBoolean("retryAuthWithQueryParam", info.retryAuthWithQueryParam);
    String qpName = cfg.getString("apiKeyQueryParamName");
    if (qpName != null && !qpName.trim().isEmpty()) {
      info.apiKeyQueryParamName = qpName.trim();
    }
    info.appendTokenToAppUrl = cfg.getBoolean("appendTokenToAppUrl", info.appendTokenToAppUrl);

    // Popup-blocker mitigation: open a placeholder tab immediately and redirect later
    info.navigateInSameTabOnBlock = cfg.getBoolean("navigateInSameTabOnBlock", info.navigateInSameTabOnBlock);

    // Enable/disable repository cloning for Gerrit changes
    info.enableCloneRepository = cfg.getBoolean("enableCloneRepository", info.enableCloneRepository);

    // Filter out git-related rich parameters if cloning is disabled
    if (!info.enableCloneRepository) {
      info.richParams.removeIf(p ->
          "GERRIT_GIT_SSH_URL".equals(p.name) || "GERRIT_CHANGE_REF".equals(p.name));

      // Also filter from template mappings
      for (ConfigInfo.TemplateMapping mapping : info.templateMappings) {
        if (mapping.richParams != null) {
          mapping.richParams.removeIf(p ->
              "GERRIT_GIT_SSH_URL".equals(p.name) || "GERRIT_CHANGE_REF".equals(p.name));
        }
      }
    }

    return Response.ok(info);
  }
}
