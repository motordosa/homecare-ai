package ai.homecare.connector

import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var originInput: EditText
    private lateinit var patientInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var ownerConfirmed: CheckBox
    private lateinit var testingConfirmed: CheckBox
    private lateinit var status: TextView
    private lateinit var controls: LinearLayout
    private var busy = false
    private var enablingBackground = false

    private val permissionRequest = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract(),
    ) {
        runAction {
            if (enablingBackground) {
                enablingBackground = false
                // Re-query the granted permissions, not just whether the permission sheet closed.
                SyncCoordinator(this).setBackground(true)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val scroll = ScrollView(this)
        controls = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(controls)
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            controls.setPadding(dp(20) + bars.left, dp(20) + bars.top, dp(20) + bars.right, dp(24) + bars.bottom)
            insets
        }
        setContentView(scroll)
        text("HomeCare 건강 연결", 26f)
        text("개발용 연결 앱 · 실기기 자동 연동 미검증", 17f)
        text("공개 데모에 실제 환자·연구 자료를 연결하지 마세요. 승인된 테스트 기기와 검증 서버에서만 사용하세요. 응급·실시간 모니터링 기능이 아닙니다.")
        text("갤럭시 워치 → 삼성 헬스 → Health Connect 공유를 먼저 설정하세요. 워치가 없어도 폰에서 제공하는 걸음 자료는 확인할 수 있지만, 수면 기록이 자동으로 생기지는 않습니다.")

        originInput = field("HTTPS 서버 주소", "https://test.example.org", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        patientInput = field("웹에 표시된 환자 ID", "환자 이름 대신 웹의 ID", InputType.TYPE_CLASS_TEXT)
        tokenInput = field("웹에서 발급한 Health Connect 연결 토큰", "연결 토큰 붙여넣기", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        tokenInput.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        tokenInput.isSaveEnabled = false
        ownerConfirmed = CheckBox(this).apply {
            text = "이 휴대폰 건강자료의 주체가 위 환자 ID와 같습니다. 보호자 본인의 자료를 환자에게 보내지 않습니다."
            textSize = 17f
        }.also(controls::addView)
        testingConfirmed = CheckBox(this).apply {
            text = "실제 환자·연구 자료가 아닌 승인된 개발 검증 자료와 서버임을 확인했습니다."
            textSize = 17f
        }.also(controls::addView)
        button("1. 연결 대상 확인하고 저장") {
            runAction {
                if (!ownerConfirmed.isChecked || !testingConfirmed.isChecked) {
                    throw ConnectorFailure("건강자료 주체와 개발 검증용 자료·서버 여부를 확인하세요.")
                }
                SyncCoordinator(this).saveConnection(
                    originInput.text.toString().trim(), tokenInput.text.toString().trim(), patientInput.text.toString().trim(),
                )
                tokenInput.text.clear()
                ownerConfirmed.isChecked = false
                testingConfirmed.isChecked = false
            }
        }
        button("2. 걸음 수·수면 읽기 허용") {
            runAction {
                requireConnection()
                val reader = HealthReader(this)
                ensureAvailable(reader)
                enablingBackground = false
                permissionRequest.launch(HealthReader.READ_PERMISSIONS)
            }
        }
        button("3. 최근 7일 동기화 / 전송 재시도") {
            runAction { SyncCoordinator(this).sync(background = false) }
        }
        button("선택: 백그라운드 자동 동기화 켜기") {
            runAction {
                requireConnection()
                val reader = HealthReader(this)
                ensureAvailable(reader)
                if (!reader.backgroundAvailable()) throw ConnectorFailure("이 기기는 백그라운드 읽기를 지원하지 않습니다. 앱을 열어 동기화하세요.")
                val required = HealthReader.READ_PERMISSIONS + HealthReader.BACKGROUND_PERMISSION
                if (reader.grantedPermissions().containsAll(required)) SyncCoordinator(this).setBackground(true)
                else {
                    enablingBackground = true
                    permissionRequest.launch(required)
                }
            }
        }
        button("자동 동기화 끄기") { runAction { SyncCoordinator(this).setBackground(false) } }
        text("자동 동기화는 운영체제의 배터리·네트워크 정책에 따라 지연됩니다. 최소 15분 작업 간격은 정시 전송 보장이 아닙니다.")
        button("Health Connect 설정 / 설치 확인") {
            try {
                val settings = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
                if (settings.resolveActivity(packageManager) != null) startActivity(settings)
                else startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata")))
            } catch (_: Exception) { status.text = "휴대폰 설정에서 Health Connect 설치·권한을 확인하세요." }
        }
        button("수집·보관 안내") { startActivity(Intent(this, PrivacyActivity::class.java)) }
        button("이 휴대폰의 연결·전송 대기 자료 삭제") {
            AlertDialog.Builder(this)
                .setTitle("휴대폰에서 연결을 지울까요?")
                .setMessage("자동 동기화와 암호화된 토큰·전송 대기 자료를 지웁니다. 서버 토큰 폐기와 서버에 이미 전송한 자료 삭제는 웹의 별도 절차가 필요합니다.")
                .setNegativeButton("취소", null)
                .setPositiveButton("휴대폰에서 삭제") { _, _ ->
                    runAction {
                        SyncCoordinator(this).clearConnection()
                        tokenInput.text.clear()
                    }
                }.show()
        }
        status = text("연결을 설정하면 여기에 서버 수신 상태가 표시됩니다.")
        try {
            SecureStore(this).config()?.let {
                originInput.setText(it.origin)
                patientInput.setText(it.patientId)
            }
        } catch (_: Exception) { status.text = "암호화된 설정을 읽을 수 없습니다. 휴대폰 연결을 삭제하고 새 토큰으로 연결하세요." }
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized && !busy) lifecycleScope.launch { refreshStatus() }
    }

    private fun requireConnection() {
        if (SecureStore(this).config() == null) throw ConnectorFailure("연결 대상을 먼저 확인하고 저장하세요.")
    }

    private fun ensureAvailable(reader: HealthReader) {
        when (reader.availability()) {
            HealthConnectClient.SDK_UNAVAILABLE -> throw ConnectorFailure("이 기기는 Health Connect를 지원하지 않습니다.")
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> throw ConnectorFailure("Health Connect를 설치하거나 업데이트하세요.")
        }
    }

    private fun runAction(action: suspend () -> Unit) {
        if (busy) return
        busy = true
        setButtonsEnabled(false)
        status.text = "처리 중입니다…"
        lifecycleScope.launch {
            try {
                action()
                refreshStatus()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: ConnectorFailure) {
                status.text = failure.safeMessage
            } catch (_: Exception) {
                status.text = "작업을 완료하지 못했습니다. 연결·권한·기기 상태를 확인하세요. 암호화 설정을 읽을 수 없다면 연결을 삭제하고 다시 설정하세요."
            } finally {
                busy = false
                setButtonsEnabled(true)
            }
        }
    }

    private suspend fun refreshStatus() {
        try {
            val store = SecureStore(this)
            val config = store.config()
            if (config == null) {
                status.text = "연결되지 않았습니다. 웹의 해당 환자에서 Health Connect 토큰을 발급한 뒤 연결 대상을 확인하세요."
                return
            }
            val reader = HealthReader(this)
            val permissions = try { reader.grantedPermissions() } catch (_: Exception) { emptySet() }
            val permissionText = if (permissions.containsAll(HealthReader.READ_PERMISSIONS)) "걸음 수·수면 읽기 허용" else "읽기 권한 또는 Health Connect 상태 확인 필요"
            status.text = "연결 환자 ID: ${config.patientId}\n$permissionText\n" +
                "자동 동기화: ${if (config.backgroundEnabled) "요청됨 (실시간 보장 없음)" else "꺼짐"}\n\n" +
                (store.status() ?: "아직 서버 수신을 확인하지 않았습니다.") +
                "\n\n빈 수면은 실제 수면 단계가 없거나 해석할 수 없다는 뜻입니다. 세션 전체 시간을 수면으로 대신하지 않습니다."
        } catch (_: Exception) {
            status.text = "연결 상태를 읽을 수 없습니다. 새 연결이 필요할 수 있습니다."
        }
    }

    private fun text(value: String, size: Float = 17f): TextView = TextView(this).apply {
        text = value
        textSize = size
        setPadding(0, dp(8), 0, dp(8))
    }.also(controls::addView)

    private fun field(label: String, hintValue: String, type: Int): EditText {
        text(label)
        return EditText(this).apply {
            hint = hintValue
            inputType = type
            textSize = 18f
            setSingleLine(true)
            isSaveEnabled = false
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
        }.also(controls::addView)
    }

    private fun button(label: String, action: () -> Unit) {
        controls.addView(Button(this).apply {
            text = label
            textSize = 17f
            isAllCaps = false
            minHeight = dp(56)
            setOnClickListener { action() }
        })
    }

    private fun setButtonsEnabled(enabled: Boolean) {
        for (index in 0 until controls.childCount) {
            val child = controls.getChildAt(index)
            if (child is Button) child.isEnabled = enabled
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
