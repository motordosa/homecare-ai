package ai.homecare.connector;

import java.net.URI;
import java.net.URISyntaxException;

/** HTTPS origin only. Reject credentials, paths, queries, fragments, and malformed ports. */
public final class ServerOrigin {
    private ServerOrigin() {}

    public static String normalize(String raw) {
        try {
            URI uri = new URI(raw.trim());
            int port = uri.getPort();
            String path = uri.getRawPath();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null
                    || uri.getRawFragment() != null || (path != null && !path.isEmpty() && !path.equals("/"))
                    || port == 0 || port > 65535 || uri.isOpaque()) {
                throw new IllegalArgumentException("HTTPS 서버 주소(경로·계정 정보 제외)가 필요합니다.");
            }
            return new URI("https", null, uri.getHost().toLowerCase(java.util.Locale.ROOT),
                    port == 443 ? -1 : port, "", null, null).toASCIIString();
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("HTTPS 서버 주소 형식을 확인하세요.");
        }
    }
}
