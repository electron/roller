import { describe, it, expect } from 'vitest';
import {
  currentWindowsImage,
  currentLinuxImages,
  getCurrentWindowsRunnerVersion,
} from '../../src/utils/arc-image';

const windowsImageContent = `electronarc.azurecr.io/win-actions-runner:main-abcdef0@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`;

const linuxImageContent = `containers:
                  - name: runner
                    resources:
                      requests:
                        cpu: "{{ .cpuRequest }}"
                        memory: "{{ .memoryRequest }}"
                    {{- if eq .cpuPlatform "linux" }}
                    {{- if eq .cpuArch "amd64" }}
                    image: ghcr.io/actions/actions-runner:2.325.0@sha256:b865e3f046f0a92a4b936ae75c5bc5615b99b64eb4801b0e5220f13f8867d6b8
                    {{- else }}
                    image: ghcr.io/actions/actions-runner:2.325.0@sha256:ab3fb968f7bcc8b34677b93a98f576142a2affde57ea2e7b461f515fd8a12453
                    {{- end }}`;

const runnerVersionContent = `FROM something-else:latest
LABEL name=arc-runner-windows

ARG RUNNER_VERSION=2.325.0
ENV RUNNER_VERSION=$RUNNER_VERSION
`;

const invalidLinuxContent = `{{- if eq .cpuArch "amd64" }}\nimage: something-else\n{{- else }}\nimage: something-else\n`;

describe('arc-image utils', () => {
  it('should extract the current Windows image', () => {
    expect(currentWindowsImage(windowsImageContent)).toBe(
      'electronarc.azurecr.io/win-actions-runner:main-abcdef0@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );
  });

  it('should extract both linux images', () => {
    const images = currentLinuxImages(linuxImageContent);
    expect(images.amd64).toBe(
      '2.325.0@sha256:b865e3f046f0a92a4b936ae75c5bc5615b99b64eb4801b0e5220f13f8867d6b8',
    );
    expect(images.arm64).toBe(
      '2.325.0@sha256:ab3fb968f7bcc8b34677b93a98f576142a2affde57ea2e7b461f515fd8a12453',
    );
  });

  it('should return empty strings for missing linux images', () => {
    const images = currentLinuxImages(invalidLinuxContent);
    expect(images.amd64).toBe('');
    expect(images.arm64).toBe('');
  });

  it('should extract the current Windows runner version', async () => {
    expect(await getCurrentWindowsRunnerVersion(runnerVersionContent)).toBe('2.325.0');
  });
});
