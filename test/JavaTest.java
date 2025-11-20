package com.gerritforge.gerrit.plugins.coderworkspace;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;

import com.google.gerrit.extensions.restapi.Response;
import com.google.gerrit.server.config.ConfigResource;
import com.google.gerrit.server.config.PluginConfig;
import com.google.gerrit.server.config.PluginConfigFactory;
import com.google.gson.Gson;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.Mock;
import org.mockito.junit.MockitoJUnitRunner;

/**
 * Unit Tests for Java Backend Components
 *
 * These tests cover the server-side Java functionality including
 * configuration loading and REST API endpoints.
 */
@RunWith(MockitoJUnitRunner.class)
public class JavaTest {

  @Mock
  private PluginConfigFactory configFactory;

  @Mock
  private PluginConfig pluginConfig;

  @Mock
  private ConfigResource configResource;

  private GetConfig getConfig;
  private Gson gson;

  @Before
  public void setUp() {
    getConfig = new GetConfig(configFactory, "coder-workspace");
    gson = new Gson();
  }

  @Test
  public void testGetConfigWithMinimalConfiguration() {
    // Given
    when(configFactory.getFromGerritConfig("coder-workspace")).thenReturn(pluginConfig);
    when(pluginConfig.getString("serverUrl")).thenReturn("https://coder.example.com");
    when(pluginConfig.getString("apiKey")).thenReturn("test-api-key");
    when(pluginConfig.getString("organization")).thenReturn("test-org");
    when(pluginConfig.getString("user", "me")).thenReturn("testuser");
    when(pluginConfig.getString("templateId")).thenReturn("template-123");
    when(pluginConfig.getString("templateVersionId")).thenReturn("version-456");
    when(pluginConfig.getString("templateVersionPresetId")).thenReturn("preset-789");
    when(pluginConfig.getString("workspaceNameTemplate", "{repo}-{change}-{patchset}"))
        .thenReturn("{repo}-{change}-{patchset}");
    when(pluginConfig.getString("automaticUpdates", "always")).thenReturn("always");
    when(pluginConfig.getBoolean("autostart", true)).thenReturn(true);
    when(pluginConfig.getBoolean("openAfterCreate", true)).thenReturn(true);
    when(pluginConfig.getBoolean("enableDryRunPreview", false)).thenReturn(false);
    when(pluginConfig.getLong("ttlMs", 0L)).thenReturn(3600000L);
    when(pluginConfig.getString("richParams")).thenReturn(null);
    when(pluginConfig.getString("templateMappingsJson")).thenReturn(null);

    // When
    Response<ConfigInfo> response = getConfig.apply(configResource);

    // Then
    assertTrue(response.isOk());
    ConfigInfo config = response.value();

    assertEquals("https://coder.example.com", config.serverUrl);
    assertEquals("test-api-key", config.apiKey);
    assertEquals("test-org", config.organization);
    assertEquals("template-123", config.templateId);
    assertEquals("version-456", config.templateVersionId);
    assertEquals("preset-789", config.templateVersionPresetId);
    assertEquals("{repo}-{change}-{patchset}", config.workspaceNameTemplate);
    assertEquals("always", config.automaticUpdates);
    assertTrue(config.autostart);
    assertTrue(config.openAfterCreate);
    assertFalse(config.enableDryRunPreview);
    assertEquals(3600000L, config.ttlMs);

    // Verify default rich params are set
    assertNotNull(config.richParams);
    assertEquals(5, config.richParams.size());
    assertEquals("REPO", config.richParams.get(0).name);
    assertEquals("repo", config.richParams.get(0).from);
    assertEquals("BRANCH", config.richParams.get(1).name);
    assertEquals("branch", config.richParams.get(1).from);
    assertEquals("GERRIT_CHANGE", config.richParams.get(2).name);
    assertEquals("change", config.richParams.get(2).from);
    assertEquals("GERRIT_PATCHSET", config.richParams.get(3).name);
    assertEquals("patchset", config.richParams.get(3).from);
    assertEquals("GERRIT_CHANGE_URL", config.richParams.get(4).name);
    assertEquals("url", config.richParams.get(4).from);

    // Verify template mappings are empty by default
    assertNotNull(config.templateMappings);
    assertTrue(config.templateMappings.isEmpty());
  }

  @Test
  public void testGetConfigWithRichParamsConfiguration() {
    // Given
    when(configFactory.getFromGerritConfig("coder-workspace")).thenReturn(pluginConfig);
    when(pluginConfig.getString("serverUrl")).thenReturn("https://coder.example.com");
    when(pluginConfig.getString("apiKey")).thenReturn("test-api-key");
    when(pluginConfig.getString("organization")).thenReturn(null);
    when(pluginConfig.getString("user", "me")).thenReturn("me");
    when(pluginConfig.getString("templateId")).thenReturn("template-123");
    when(pluginConfig.getString("templateVersionId")).thenReturn(null);
    when(pluginConfig.getString("templateVersionPresetId")).thenReturn(null);
    when(pluginConfig.getString("workspaceNameTemplate", "{repo}-{change}-{patchset}"))
        .thenReturn("{repo}-{change}-{patchset}");
    when(pluginConfig.getString("automaticUpdates", "always")).thenReturn("always");
    when(pluginConfig.getBoolean("autostart", true)).thenReturn(true);
    when(pluginConfig.getBoolean("openAfterCreate", true)).thenReturn(true);
    when(pluginConfig.getBoolean("enableDryRunPreview", false)).thenReturn(false);
    when(pluginConfig.getLong("ttlMs", 0L)).thenReturn(0L);
    when(pluginConfig.getString("richParams"))
        .thenReturn("CUSTOM_REPO:repo,CUSTOM_BRANCH:branch,CUSTOM_CHANGE:change");
    when(pluginConfig.getString("templateMappingsJson")).thenReturn(null);

    // When
    Response<ConfigInfo> response = getConfig.apply(configResource);

    // Then
    assertTrue(response.isOk());
    ConfigInfo config = response.value();

    // Verify custom rich params override defaults
    assertNotNull(config.richParams);
    assertEquals(3, config.richParams.size());
    assertEquals("CUSTOM_REPO", config.richParams.get(0).name);
    assertEquals("repo", config.richParams.get(0).from);
    assertEquals("CUSTOM_BRANCH", config.richParams.get(1).name);
    assertEquals("branch", config.richParams.get(1).from);
    assertEquals("CUSTOM_CHANGE", config.richParams.get(2).name);
    assertEquals("change", config.richParams.get(2).from);
  }

  @Test
  public void testGetConfigWithTemplateMappingsConfiguration() {
    // Given
    String mappingsJson = "["
        + "{"
        + "\"repo\":\"my/org/*\","
        + "\"branch\":\"refs/heads/main\","
        + "\"templateVersionId\":\"template-main-123\","
        + "\"workspaceNameTemplate\":\"{repo}-main-{change}\","
        + "\"richParams\":["
        + "{\"name\":\"REPO\",\"from\":\"repo\"},"
        + "{\"name\":\"BRANCH\",\"from\":\"branch\"}"
        + "]"
        + "},"
        + "{"
        + "\"repo\":\"my/org/*\","
        + "\"branch\":\"refs/heads/*\","
        + "\"templateId\":\"template-any-456\""
        + "}"
        + "]";

    when(configFactory.getFromGerritConfig("coder-workspace")).thenReturn(pluginConfig);
    when(pluginConfig.getString("serverUrl")).thenReturn("https://coder.example.com");
    when(pluginConfig.getString("apiKey")).thenReturn("test-api-key");
    when(pluginConfig.getString("organization")).thenReturn(null);
    when(pluginConfig.getString("user", "me")).thenReturn("me");
    when(pluginConfig.getString("templateId")).thenReturn("default-template");
    when(pluginConfig.getString("templateVersionId")).thenReturn(null);
    when(pluginConfig.getString("templateVersionPresetId")).thenReturn(null);
    when(pluginConfig.getString("workspaceNameTemplate", "{repo}-{change}-{patchset}"))
        .thenReturn("{repo}-{change}-{patchset}");
    when(pluginConfig.getString("automaticUpdates", "always")).thenReturn("always");
    when(pluginConfig.getBoolean("autostart", true)).thenReturn(true);
    when(pluginConfig.getBoolean("openAfterCreate", true)).thenReturn(true);
    when(pluginConfig.getBoolean("enableDryRunPreview", false)).thenReturn(false);
    when(pluginConfig.getLong("ttlMs", 0L)).thenReturn(0L);
    when(pluginConfig.getString("richParams")).thenReturn(null);
    when(pluginConfig.getString("templateMappingsJson")).thenReturn(mappingsJson);

    // When
    Response<ConfigInfo> response = getConfig.apply(configResource);

    // Then
    assertTrue(response.isOk());
    ConfigInfo config = response.value();

    // Verify template mappings are parsed correctly
    assertNotNull(config.templateMappings);
    assertEquals(2, config.templateMappings.size());

    // First mapping
    ConfigInfo.TemplateMapping mapping1 = config.templateMappings.get(0);
    assertEquals("my/org/*", mapping1.repo);
    assertEquals("refs/heads/main", mapping1.branch);
    assertEquals("template-main-123", mapping1.templateVersionId);
    assertEquals("{repo}-main-{change}", mapping1.workspaceNameTemplate);
    assertNotNull(mapping1.richParams);
    assertEquals(2, mapping1.richParams.size());
    assertEquals("REPO", mapping1.richParams.get(0).name);
    assertEquals("repo", mapping1.richParams.get(0).from);
    assertEquals("BRANCH", mapping1.richParams.get(1).name);
    assertEquals("branch", mapping1.richParams.get(1).from);

    // Second mapping
    ConfigInfo.TemplateMapping mapping2 = config.templateMappings.get(1);
    assertEquals("my/org/*", mapping2.repo);
    assertEquals("refs/heads/*", mapping2.branch);
    assertEquals("template-any-456", mapping2.templateId);
    assertNull(mapping2.templateVersionId);
    assertNull(mapping2.workspaceNameTemplate);
    assertNull(mapping2.richParams);
  }

  @Test
  public void testGetConfigWithInvalidTemplateMappingsJson() {
    // Given
    when(configFactory.getFromGerritConfig("coder-workspace")).thenReturn(pluginConfig);
    when(pluginConfig.getString("serverUrl")).thenReturn("https://coder.example.com");
    when(pluginConfig.getString("apiKey")).thenReturn("test-api-key");
    when(pluginConfig.getString("organization")).thenReturn(null);
    when(pluginConfig.getString("user", "me")).thenReturn("me");
    when(pluginConfig.getString("templateId")).thenReturn("template-123");
    when(pluginConfig.getString("templateVersionId")).thenReturn(null);
    when(pluginConfig.getString("templateVersionPresetId")).thenReturn(null);
    when(pluginConfig.getString("workspaceNameTemplate", "{repo}-{change}-{patchset}"))
        .thenReturn("{repo}-{change}-{patchset}");
    when(pluginConfig.getString("automaticUpdates", "always")).thenReturn("always");
    when(pluginConfig.getBoolean("autostart", true)).thenReturn(true);
    when(pluginConfig.getBoolean("openAfterCreate", true)).thenReturn(true);
    when(pluginConfig.getBoolean("enableDryRunPreview", false)).thenReturn(false);
    when(pluginConfig.getLong("ttlMs", 0L)).thenReturn(0L);
    when(pluginConfig.getString("richParams")).thenReturn(null);
    when(pluginConfig.getString("templateMappingsJson")).thenReturn("invalid json");

    // When
    Response<ConfigInfo> response = getConfig.apply(configResource);

    // Then
    assertTrue(response.isOk());
    ConfigInfo config = response.value();

    // Should fall back to default empty mappings
    assertNotNull(config.templateMappings);
    assertTrue(config.templateMappings.isEmpty());
  }

  @Test
  public void testGetConfigWithEmptyRichParams() {
    // Given
    when(configFactory.getFromGerritConfig("coder-workspace")).thenReturn(pluginConfig);
    when(pluginConfig.getString("serverUrl")).thenReturn("https://coder.example.com");
    when(pluginConfig.getString("apiKey")).thenReturn("test-api-key");
    when(pluginConfig.getString("organization")).thenReturn(null);
    when(pluginConfig.getString("user", "me")).thenReturn("me");
    when(pluginConfig.getString("templateId")).thenReturn("template-123");
    when(pluginConfig.getString("templateVersionId")).thenReturn(null);
    when(pluginConfig.getString("templateVersionPresetId")).thenReturn(null);
    when(pluginConfig.getString("workspaceNameTemplate", "{repo}-{change}-{patchset}"))
        .thenReturn("{repo}-{change}-{patchset}");
    when(pluginConfig.getString("automaticUpdates", "always")).thenReturn("always");
    when(pluginConfig.getBoolean("autostart", true)).thenReturn(true);
    when(pluginConfig.getBoolean("openAfterCreate", true)).thenReturn(true);
    when(pluginConfig.getBoolean("enableDryRunPreview", false)).thenReturn(false);
    when(pluginConfig.getLong("ttlMs", 0L)).thenReturn(0L);
    when(pluginConfig.getString("richParams")).thenReturn("");
    when(pluginConfig.getString("templateMappingsJson")).thenReturn(null);

    // When
    Response<ConfigInfo> response = getConfig.apply(configResource);

    // Then
    assertTrue(response.isOk());
    ConfigInfo config = response.value();

    // Should use default rich params when empty string is provided
    assertNotNull(config.richParams);
    assertEquals(5, config.richParams.size());
  }

  @Test
  public void testGetConfigWithWhitespaceRichParams() {
    // Given
    when(configFactory.getFromGerritConfig("coder-workspace")).thenReturn(pluginConfig);
    when(pluginConfig.getString("serverUrl")).thenReturn("https://coder.example.com");
    when(pluginConfig.getString("apiKey")).thenReturn("test-api-key");
    when(pluginConfig.getString("organization")).thenReturn(null);
    when(pluginConfig.getString("user", "me")).thenReturn("me");
    when(pluginConfig.getString("templateId")).thenReturn("template-123");
    when(pluginConfig.getString("templateVersionId")).thenReturn(null);
    when(pluginConfig.getString("templateVersionPresetId")).thenReturn(null);
    when(pluginConfig.getString("workspaceNameTemplate", "{repo}-{change}-{patchset}"))
        .thenReturn("{repo}-{change}-{patchset}");
    when(pluginConfig.getString("automaticUpdates", "always")).thenReturn("always");
    when(pluginConfig.getBoolean("autostart", true)).thenReturn(true);
    when(pluginConfig.getBoolean("openAfterCreate", true)).thenReturn(true);
    when(pluginConfig.getBoolean("enableDryRunPreview", false)).thenReturn(false);
    when(pluginConfig.getLong("ttlMs", 0L)).thenReturn(0L);
    when(pluginConfig.getString("richParams")).thenReturn("   ");
    when(pluginConfig.getString("templateMappingsJson")).thenReturn(null);

    // When
    Response<ConfigInfo> response = getConfig.apply(configResource);

    // Then
    assertTrue(response.isOk());
    ConfigInfo config = response.value();

    // Should use default rich params when only whitespace is provided
    assertNotNull(config.richParams);
    assertEquals(5, config.richParams.size());
  }

  @Test
  public void testGetConfigWithMalformedRichParams() {
    // Given
    when(configFactory.getFromGerritConfig("coder-workspace")).thenReturn(pluginConfig);
    when(pluginConfig.getString("serverUrl")).thenReturn("https://coder.example.com");
    when(pluginConfig.getString("apiKey")).thenReturn("test-api-key");
    when(pluginConfig.getString("organization")).thenReturn(null);
    when(pluginConfig.getString("user", "me")).thenReturn("me");
    when(pluginConfig.getString("templateId")).thenReturn("template-123");
    when(pluginConfig.getString("templateVersionId")).thenReturn(null);
    when(pluginConfig.getString("templateVersionPresetId")).thenReturn(null);
    when(pluginConfig.getString("workspaceNameTemplate", "{repo}-{change}-{patchset}"))
        .thenReturn("{repo}-{change}-{patchset}");
    when(pluginConfig.getString("automaticUpdates", "always")).thenReturn("always");
    when(pluginConfig.getBoolean("autostart", true)).thenReturn(true);
    when(pluginConfig.getBoolean("openAfterCreate", true)).thenReturn(true);
    when(pluginConfig.getBoolean("enableDryRunPreview", false)).thenReturn(false);
    when(pluginConfig.getLong("ttlMs", 0L)).thenReturn(0L);
    when(pluginConfig.getString("richParams")).thenReturn("INVALID_FORMAT");
    when(pluginConfig.getString("templateMappingsJson")).thenReturn(null);

    // When
    Response<ConfigInfo> response = getConfig.apply(configResource);

    // Then
    assertTrue(response.isOk());
    ConfigInfo config = response.value();

    // Should use default rich params when format is invalid
    assertNotNull(config.richParams);
    assertEquals(5, config.richParams.size());
  }

  @Test
  public void testConfigInfoDefaultValues() {
    // Given
    ConfigInfo config = new ConfigInfo();

    // Then
    assertEquals("{repo}-{change}-{patchset}", config.workspaceNameTemplate);
    assertEquals("always", config.automaticUpdates);
    assertTrue(config.autostart);
    assertTrue(config.openAfterCreate);
    assertFalse(config.enableDryRunPreview);
    assertEquals(0L, config.ttlMs);
    assertNotNull(config.richParams);
    assertEquals(5, config.richParams.size());
    assertNotNull(config.templateMappings);
    assertTrue(config.templateMappings.isEmpty());
  }

  @Test
  public void testRichParamConstructor() {
    // Given
    String name = "TEST_PARAM";
    String from = "testField";

    // When
    ConfigInfo.RichParam richParam = new ConfigInfo.RichParam(name, from);

    // Then
    assertEquals(name, richParam.name);
    assertEquals(from, richParam.from);
  }

  @Test
  public void testRichParamDefaultConstructor() {
    // Given & When
    ConfigInfo.RichParam richParam = new ConfigInfo.RichParam();

    // Then
    assertNull(richParam.name);
    assertNull(richParam.from);
  }

  @Test
  public void testTemplateMappingDefaultValues() {
    // Given & When
    ConfigInfo.TemplateMapping mapping = new ConfigInfo.TemplateMapping();

    // Then
    assertNull(mapping.repo);
    assertNull(mapping.branch);
    assertNull(mapping.templateId);
    assertNull(mapping.templateVersionId);
    assertNull(mapping.templateVersionPresetId);
    assertNull(mapping.workspaceNameTemplate);
    assertNull(mapping.richParams);
  }

  @Test
  public void testGetConfigWithNullValues() {
    // Given
    when(configFactory.getFromGerritConfig("coder-workspace")).thenReturn(pluginConfig);
    when(pluginConfig.getString("serverUrl")).thenReturn(null);
    when(pluginConfig.getString("apiKey")).thenReturn(null);
    when(pluginConfig.getString("organization")).thenReturn(null);
    when(pluginConfig.getString("user", "me")).thenReturn("me");
    when(pluginConfig.getString("templateId")).thenReturn(null);
    when(pluginConfig.getString("templateVersionId")).thenReturn(null);
    when(pluginConfig.getString("templateVersionPresetId")).thenReturn(null);
    when(pluginConfig.getString("workspaceNameTemplate", "{repo}-{change}-{patchset}"))
        .thenReturn("{repo}-{change}-{patchset}");
    when(pluginConfig.getString("automaticUpdates", "always")).thenReturn("always");
    when(pluginConfig.getBoolean("autostart", true)).thenReturn(true);
    when(pluginConfig.getBoolean("openAfterCreate", true)).thenReturn(true);
    when(pluginConfig.getBoolean("enableDryRunPreview", false)).thenReturn(false);
    when(pluginConfig.getLong("ttlMs", 0L)).thenReturn(0L);
    when(pluginConfig.getString("richParams")).thenReturn(null);
    when(pluginConfig.getString("templateMappingsJson")).thenReturn(null);

    // When
    Response<ConfigInfo> response = getConfig.apply(configResource);

    // Then
    assertTrue(response.isOk());
    ConfigInfo config = response.value();

    assertNull(config.serverUrl);
    assertNull(config.apiKey);
    assertNull(config.organization);
    assertNull(config.templateId);
    assertNull(config.templateVersionId);
    assertNull(config.templateVersionPresetId);
    assertEquals("{repo}-{change}-{patchset}", config.workspaceNameTemplate);
    assertEquals("always", config.automaticUpdates);
    assertTrue(config.autostart);
    assertTrue(config.openAfterCreate);
    assertFalse(config.enableDryRunPreview);
    assertEquals(0L, config.ttlMs);
  }
}
