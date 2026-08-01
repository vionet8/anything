using UnityEngine;
using UnityEngine.UI;

public class GameManager : MonoBehaviour
{
    public Text scoreText;
    public Text roundText;
    public Image powerMeterFill;
    public int totalRounds = 5;

    int score;
    int round = 1;

    public bool IsGameOver => round > totalRounds;

    void Start()
    {
        UpdateUI();
    }

    public void AddScore(int points)
    {
        score += points;
        round++;
        UpdateUI();
    }

    public void SetChargeRatio(float ratio)
    {
        if (powerMeterFill != null) powerMeterFill.fillAmount = ratio;
    }

    void UpdateUI()
    {
        if (scoreText != null) scoreText.text = $"Score: {score}";
        if (roundText != null)
        {
            roundText.text = IsGameOver
                ? $"Finished! Score: {score}"
                : $"Round: {round}/{totalRounds}";
        }
    }
}
