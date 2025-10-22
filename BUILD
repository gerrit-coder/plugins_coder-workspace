load("//tools/bzl:js.bzl", "gerrit_js_bundle")
load("//tools/bzl:plugin.bzl", "gerrit_plugin")

# Bundle the plugin TS/JS into a jar under static/coder-workspace.js

gerrit_js_bundle(
    name = "coder-workspace-static",
    entry_point = "plugin.js",
    srcs = [
        "plugin.js",
    ],
)

gerrit_plugin(
    name = "coder-workspace",
    srcs = [
        "java/com/gerritforge/gerrit/plugins/coderworkspace/Module.java",
        "java/com/gerritforge/gerrit/plugins/coderworkspace/ConfigInfo.java",
        "java/com/gerritforge/gerrit/plugins/coderworkspace/GetConfig.java",
    ],
    manifest_entries = [
        "Gerrit-PluginName: coder-workspace",
        "Gerrit-Module: com.gerritforge.gerrit.plugins.coderworkspace.Module",
        "Implementation-Title: Coder Workspace Integration Plugin",
        "Implementation-Vendor: Gerrit Community",
    ],
    resource_jars = [":coder-workspace-static"],
)
