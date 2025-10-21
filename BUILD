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
    resource_jars = [":coder-workspace-static"],
    # No server-side Java code for this plugin
)
