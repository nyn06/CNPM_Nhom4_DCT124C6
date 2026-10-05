const EARTH_RADIUS_METERS = 6371000;

// Tọa độ đầu vào đã được Service kiểm tra, đơn vị độ; kết quả là mét chưa làm tròn.
function calculateDistanceInMeters(latitude1, longitude1, latitude2, longitude2) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(latitude2 - latitude1);
  const longitudeDelta = toRadians(longitude2 - longitude1);

  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(latitude1)) * Math.cos(toRadians(latitude2))
    * Math.sin(longitudeDelta / 2) ** 2;

  // Sai số dấu phẩy động có thể đẩy giá trị ra ngoài [0, 1] ở hai điểm đối cực.
  const boundedHaversine = Math.min(1, Math.max(0, haversine));
  const centralAngle = 2 * Math.atan2(
    Math.sqrt(boundedHaversine),
    Math.sqrt(1 - boundedHaversine)
  );

  return EARTH_RADIUS_METERS * centralAngle;
}

module.exports = { calculateDistanceInMeters };
