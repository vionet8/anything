using UnityEngine;

public class DartLauncher : MonoBehaviour
{
    public GameObject dartPrefab;
    public Transform launchPoint;
    public GameManager gameManager;

    public float launchAngle = 55f;
    public float minPower = 4f;
    public float maxPower = 14f;
    public float chargeDuration = 1.2f;

    float chargeTime;
    bool isCharging;
    bool dartInFlight;

    void Update()
    {
        if (dartInFlight) return;
        if (gameManager != null && gameManager.IsGameOver) return;

        bool pointerDown = Input.GetMouseButtonDown(0) || (Input.touchCount > 0 && Input.GetTouch(0).phase == TouchPhase.Began);
        bool pointerHeld = Input.GetMouseButton(0) || (Input.touchCount > 0 && (Input.GetTouch(0).phase == TouchPhase.Stationary || Input.GetTouch(0).phase == TouchPhase.Moved));
        bool pointerUp = Input.GetMouseButtonUp(0) || (Input.touchCount > 0 && Input.GetTouch(0).phase == TouchPhase.Ended);

        if (pointerDown)
        {
            isCharging = true;
            chargeTime = 0f;
        }
        else if (isCharging && pointerHeld)
        {
            chargeTime = Mathf.Min(chargeTime + Time.deltaTime, chargeDuration);
            if (gameManager != null) gameManager.SetChargeRatio(chargeTime / chargeDuration);
        }
        else if (isCharging && pointerUp)
        {
            Fire(chargeTime / chargeDuration);
            isCharging = false;
            if (gameManager != null) gameManager.SetChargeRatio(0f);
        }
    }

    void Fire(float ratio)
    {
        float power = Mathf.Lerp(minPower, maxPower, ratio);
        float rad = launchAngle * Mathf.Deg2Rad;
        Vector2 velocity = new Vector2(Mathf.Cos(rad), Mathf.Sin(rad)) * power;

        var dartObj = Instantiate(dartPrefab, launchPoint.position, Quaternion.identity);
        var dart = dartObj.GetComponent<DartController>();
        dart.Launch(velocity);
        dart.OnScored += HandleScored;
        dartInFlight = true;
    }

    void HandleScored(int score)
    {
        dartInFlight = false;
        if (gameManager != null) gameManager.AddScore(score);
    }
}
