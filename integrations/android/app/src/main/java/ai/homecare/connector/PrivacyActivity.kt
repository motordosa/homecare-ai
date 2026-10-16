package ai.homecare.connector

import android.app.Activity
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView

/** The OS permission rationale contains no connection details or secrets. */
class PrivacyActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = TextView(this).apply {
            textSize = 18f
            setPadding(40, 80, 40, 80)
            text = """
                HomeCare 건강 연결 · 개발용 / 실기기 미검증

                걸음 수와 수면 단계만 Health Connect에서 읽습니다. 최근 7일을 서울 시간 일자로 집계해 사용자가 입력한 HTTPS 서버로 전송합니다. 수면 단계가 없거나 알 수 없으면 수면값은 비어 있으며 침대·세션 시간을 수면으로 대신하지 않습니다.

                이 휴대폰 건강자료의 주체와 웹의 환자 ID가 같아야 합니다. 보호자 폰 자료를 환자에게 보내지 마세요. 실제 환자·연구 자료를 공개 데모에 연결하지 마세요.

                연결 토큰과 전송 대기 자료는 Android Keystore 키로 암호화해 이 기기에 저장하며 백업에서 제외합니다. 서버는 토큰에 연결된 환자에게 자료를 저장합니다. 서버의 접근통제·보관기간·삭제 절차는 운영 주체와 별도로 확인해야 합니다.

                백그라운드 읽기는 별도 동의가 있어야 실행합니다. 운영체제 상태에 따라 지연될 수 있으며 응급 감시 기능이 아닙니다. 권한은 휴대폰 Health Connect 설정에서 철회할 수 있습니다.

                앱에서 연결을 삭제하면 로컬 토큰·전송 대기 자료와 자동 동기화를 지웁니다. 서버 토큰 폐기와 이미 전송한 자료 삭제는 웹의 별도 절차입니다.

                이 안내는 연구 참여 동의서나 기관 개인정보 처리방침을 대신하지 않습니다. 배포 전 책임자·연락처·보관/삭제 규칙과 앱스토어 심사 문서를 완성해야 합니다.
            """.trimIndent()
        }
        setContentView(ScrollView(this).apply { addView(text) })
    }
}
