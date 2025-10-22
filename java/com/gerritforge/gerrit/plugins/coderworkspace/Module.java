package com.gerritforge.gerrit.plugins.coderworkspace;

import static com.google.gerrit.server.config.ConfigResource.CONFIG_KIND;

import com.google.gerrit.extensions.registration.DynamicSet;
import com.google.gerrit.extensions.restapi.RestApiModule;
import com.google.gerrit.extensions.webui.JavaScriptPlugin;
import com.google.gerrit.extensions.webui.WebUiPlugin;
import com.google.inject.AbstractModule;

public class Module extends AbstractModule {
  @Override
  protected void configure() {
    DynamicSet.bind(binder(), WebUiPlugin.class)
        .toInstance(new JavaScriptPlugin("coder-workspace-static.js"));

    // Expose GET /config/server/coder-workspace.config with settings from gerrit.config
    install(
        new RestApiModule() {
          @Override
          protected void configure() {
            get(CONFIG_KIND, "coder-workspace.config").to(GetConfig.class);
          }
        });
  }
}
