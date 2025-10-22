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
    info.user = cfg.getString("user", info.user);

    info.templateId = cfg.getString("templateId");
    info.templateVersionId = cfg.getString("templateVersionId");
    info.templateVersionPresetId = cfg.getString("templateVersionPresetId");

    info.workspaceNameTemplate = cfg.getString("workspaceNameTemplate", info.workspaceNameTemplate);
    info.automaticUpdates = cfg.getString("automaticUpdates", info.automaticUpdates);
    info.autostart = cfg.getBoolean("autostart", info.autostart);
    info.openAfterCreate = cfg.getBoolean("openAfterCreate", info.openAfterCreate);
    info.enableDryRunPreview = cfg.getBoolean("enableDryRunPreview", info.enableDryRunPreview);
    info.ttlMs = cfg.getLong("ttlMs", info.ttlMs);
    info.historyLimit = cfg.getInt("historyLimit", info.historyLimit);

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

    return Response.ok(info);
  }
}
